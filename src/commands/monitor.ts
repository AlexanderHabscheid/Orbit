import fs from "node:fs";
import path from "node:path";
import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { prefixedSubject } from "../subjects.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localServices(config: OrbitConfig): string[] {
  if (!fs.existsSync(config.servicesDir)) return [];
  return fs
    .readdirSync(config.servicesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.basename(name, ".json"));
}

interface AlertState {
  active: Set<string>;
  streaks: Map<string, number>;
  lastEventMs: Map<string, number>;
}

interface AlertPolicy {
  consecutive: number;
  cooldownMs: number;
}

interface AlertEvaluation {
  active: string[];
  emit: Array<{ event: "alert" | "alert_resolved"; code: string }>;
}

export function evaluateAlerts(
  state: AlertState,
  presentCodes: string[],
  nowMs: number,
  policy: AlertPolicy
): AlertEvaluation {
  const presentSet = new Set<string>(presentCodes);
  const nextActive = new Set<string>();
  for (const code of presentSet) {
    const n = (state.streaks.get(code) ?? 0) + 1;
    state.streaks.set(code, n);
    if (n >= policy.consecutive) nextActive.add(code);
  }
  for (const code of Array.from(state.streaks.keys())) {
    if (!presentSet.has(code)) state.streaks.set(code, 0);
  }

  const emit: Array<{ event: "alert" | "alert_resolved"; code: string }> = [];
  for (const code of nextActive) {
    if (!state.active.has(code)) {
      const last = state.lastEventMs.get(`alert:${code}`);
      if (last === undefined || policy.cooldownMs <= 0 || nowMs - last >= policy.cooldownMs) {
        emit.push({ event: "alert", code });
        state.lastEventMs.set(`alert:${code}`, nowMs);
      }
    }
  }
  for (const code of state.active) {
    if (!nextActive.has(code)) {
      const last = state.lastEventMs.get(`alert_resolved:${code}`);
      if (last === undefined || policy.cooldownMs <= 0 || nowMs - last >= policy.cooldownMs) {
        emit.push({ event: "alert_resolved", code });
        state.lastEventMs.set(`alert_resolved:${code}`, nowMs);
      }
    }
  }

  state.active = nextActive;
  return { active: Array.from(nextActive), emit };
}

async function runLimited<T>(items: string[], maxParallel: number, work: (item: string) => Promise<T>): Promise<T[]> {
  const out: T[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(items.length, maxParallel) }, async () => {
    while (idx < items.length) {
      const current = items[idx];
      idx += 1;
      out.push(await work(current));
    }
  });
  await Promise.all(workers);
  return out;
}

export async function cmdMonitor(
  config: OrbitConfig,
  logger: Logger,
  opts: {
    service?: string;
    intervalMs: number;
    timeoutMs?: number;
    once?: boolean;
    alerts?: boolean;
    alertDown?: boolean;
    alertLatencyMs?: number;
    alertErrorRate?: number;
    alertConsecutive?: number;
    alertCooldownSec?: number;
  }
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? config.requestTimeoutMs;
  const intervalMs = Math.max(200, opts.intervalMs);
  const known = new Set<string>(opts.service ? [opts.service] : localServices(config));
  const alertStates = new Map<string, AlertState>();
  const downStreaks = new Map<string, number>();
  const nextProbeAt = new Map<string, number>();
  const nc = await connectBus(config.natsUrl);
  const policy: AlertPolicy = {
    consecutive: Math.max(1, Math.floor(opts.alertConsecutive ?? 1)),
    cooldownMs: Math.max(0, Math.floor((opts.alertCooldownSec ?? 0) * 1000))
  };

  const ann = nc.subscribe(prefixedSubject(config, "discovery", "announce", "*"));
  (async () => {
    for await (const msg of ann) {
      try {
        const decoded = decodeJson(msg.data) as { payload?: { service?: string } } | { service?: string };
        const payloadService =
          decoded && typeof decoded === "object" && "payload" in decoded
            ? (decoded as { payload?: { service?: string } }).payload?.service
            : undefined;
        const service =
          payloadService ??
          (decoded && typeof decoded === "object" && "service" in decoded
            ? (decoded as { service?: string }).service
            : undefined);
        if (!opts.service && service) known.add(service);
      } catch {
        logger.debug("failed to parse discovery announce", { subject: msg.subject });
      }
    }
  })().catch((err) => logger.error("monitor discovery loop failed", { err: String(err) }));

  while (true) {
    const ts = new Date().toISOString();
    const now = Date.now();
    const targets = opts.service ? [opts.service] : Array.from(known);
    if (targets.length === 0) {
      process.stdout.write(`${JSON.stringify({ ts, event: "idle", message: "no known services to monitor" })}\n`);
      if (opts.once) break;
      const jitter = config.runtime.monitorJitterMs > 0 ? Math.floor(Math.random() * config.runtime.monitorJitterMs) : 0;
      await sleep(intervalMs + jitter);
      continue;
    }

    const dueTargets = opts.once ? targets : targets.filter((service) => (nextProbeAt.get(service) ?? 0) <= now);
    if (dueTargets.length > 0) {
      await runLimited(dueTargets, config.runtime.monitorMaxParallel, async (service) => {
        const started = Date.now();
        let pingOk = false;
        let pingLatencyMs = -1;
        try {
          await nc.request(`$SRV.PING.${service}`, new Uint8Array(), { timeout: timeoutMs });
          pingOk = true;
          pingLatencyMs = Date.now() - started;
        } catch {
          pingOk = false;
        }

        let stats: unknown = null;
        let errorRate: number | null = null;
        try {
          const msg = await nc.request(`$SRV.STATS.${service}`, new Uint8Array(), { timeout: timeoutMs });
          stats = decodeJson(msg.data);
          if (stats && typeof stats === "object" && "endpoints" in (stats as Record<string, unknown>)) {
            const endpoints = (stats as { endpoints?: Array<{ num_requests?: number; num_errors?: number }> }).endpoints ?? [];
            const totalReq = endpoints.reduce((sum, e) => sum + (e.num_requests ?? 0), 0);
            const totalErr = endpoints.reduce((sum, e) => sum + (e.num_errors ?? 0), 0);
            errorRate = totalReq > 0 ? totalErr / totalReq : 0;
          }
        } catch {
          stats = null;
        }

        if (pingOk) {
          downStreaks.set(service, 0);
          nextProbeAt.set(service, Date.now() + intervalMs);
        } else {
          const streak = (downStreaks.get(service) ?? 0) + 1;
          downStreaks.set(service, streak);
          const exp = Math.pow(config.runtime.monitorDownBackoffFactor, Math.max(0, streak - 1));
          const backoffMs = Math.min(config.runtime.monitorDownBackoffMaxMs, Math.floor(intervalMs * exp));
          nextProbeAt.set(service, Date.now() + backoffMs);
        }

        const alertCodes: string[] = [];
        if (opts.alerts || opts.alertDown || opts.alertLatencyMs !== undefined || opts.alertErrorRate !== undefined) {
          if ((opts.alertDown ?? true) && !pingOk) alertCodes.push("SERVICE_DOWN");
          if (opts.alertLatencyMs !== undefined && pingLatencyMs >= 0 && pingLatencyMs > opts.alertLatencyMs) {
            alertCodes.push("HIGH_LATENCY");
          }
          if (opts.alertErrorRate !== undefined && errorRate !== null && errorRate > opts.alertErrorRate) {
            alertCodes.push("HIGH_ERROR_RATE");
          }
        }

        const shouldEvaluateAlerts = opts.alerts || opts.alertDown || opts.alertLatencyMs !== undefined || opts.alertErrorRate !== undefined;
        let evaluatedAlerts = alertCodes;
        let emitEvents: Array<{ event: "alert" | "alert_resolved"; code: string }> = [];
        if (shouldEvaluateAlerts) {
          const state = alertStates.get(service) ?? {
            active: new Set<string>(),
            streaks: new Map<string, number>(),
            lastEventMs: new Map<string, number>()
          };
          const evalResult = evaluateAlerts(state, alertCodes, Date.now(), policy);
          alertStates.set(service, state);
          evaluatedAlerts = evalResult.active;
          emitEvents = evalResult.emit;
        }

        process.stdout.write(
          `${JSON.stringify({
            ts,
            service,
            status: pingOk ? "up" : "down",
            ping_latency_ms: pingLatencyMs >= 0 ? pingLatencyMs : null,
            error_rate: errorRate,
            alerts: evaluatedAlerts,
            alert_policy: shouldEvaluateAlerts
              ? { consecutive: policy.consecutive, cooldown_sec: Number((policy.cooldownMs / 1000).toFixed(3)) }
              : undefined,
            stats
          })}\n`
        );

        for (const e of emitEvents) {
          process.stdout.write(
            `${JSON.stringify({
              ts,
              event: e.event,
              service,
              code: e.code
            })}\n`
          );
        }
      });
    }

    if (opts.once) break;
    const jitter = config.runtime.monitorJitterMs > 0 ? Math.floor(Math.random() * config.runtime.monitorJitterMs) : 0;
    await sleep(intervalMs + jitter);
  }

  await closeBus(config.natsUrl);
}
