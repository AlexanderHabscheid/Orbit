import { Msg } from "nats";
import { createEnvelope, validateEnvelope } from "../envelope.js";
import { Logger } from "../logger.js";
import { connectBus, decodeJson, encodeJson } from "../nats.js";
import { saveServiceRecordDistributed } from "../registry.js";
import { loadServiceSpec } from "../spec.js";
import { appendTraceEvent } from "../trace.js";
import { OrbitConfig } from "../types.js";
import { executeMethod } from "../service_adapter.js";
import { randomId } from "../util.js";
import { prefixedSubject } from "../subjects.js";

function serviceSummary(service: string, specPath: string, spec: ReturnType<typeof loadServiceSpec>) {
  return {
    service,
    version: spec.version ?? "0.0.0",
    description: spec.description ?? "",
    spec_path: specPath,
    methods: Object.entries(spec.methods).map(([name, m]) => ({
      name,
      description: m.description ?? "",
      request_schema: m.request_schema ?? {},
      response_schema: m.response_schema ?? {}
    }))
  };
}

function matchesServiceApiSubject(subject: string, prefix: "$SRV.PING" | "$SRV.INFO" | "$SRV.STATS", name: string, id: string): boolean {
  if (subject === prefix) return true;
  if (subject === `${prefix}.${name}`) return true;
  if (subject === `${prefix}.${name}.${id}`) return true;
  return false;
}

interface MethodRuntime {
  queue: Msg[];
  inflight: number;
  totalRequests: number;
  totalErrors: number;
  subject: string;
}

export async function cmdServe(
  config: OrbitConfig,
  logger: Logger,
  opts: { name: string; specPath: string; queueGroup?: string; concurrency: number }
): Promise<void> {
  const spec = loadServiceSpec(opts.specPath);
  await saveServiceRecordDistributed(config, opts.name, spec);

  const methodNames = Object.keys(spec.methods);
  const perMethodLimit = Math.max(1, Math.min(opts.concurrency, config.runtime.serveMaxInflightPerMethod));
  const globalLimit = Math.max(perMethodLimit, config.runtime.serveMaxInflightGlobal);
  const queueLimit = config.runtime.serveMaxQueueDepth;

  const nc = await connectBus(config.natsUrl);
  const summary = serviceSummary(opts.name, opts.specPath, spec);
  const serviceInstanceId = randomId();
  const startedAt = new Date().toISOString();
  let globalInflight = 0;

  const methods = new Map<string, MethodRuntime>();
  for (const methodName of methodNames) {
    methods.set(methodName, {
      queue: [],
      inflight: 0,
      totalRequests: 0,
      totalErrors: 0,
      subject: prefixedSubject(config, "rpc", opts.name, methodName)
    });
  }

  const tryDrainMethod = (methodName: string): void => {
    const methodState = methods.get(methodName);
    if (!methodState) return;

    while (
      methodState.queue.length > 0 &&
      methodState.inflight < perMethodLimit &&
      globalInflight < globalLimit
    ) {
      const msg = methodState.queue.shift();
      if (!msg) break;

      methodState.inflight += 1;
      methodState.totalRequests += 1;
      globalInflight += 1;

      void (async () => {
        const start = Date.now();
        let runId = "";
        try {
          const env = validateEnvelope(decodeJson(msg.data), { skipHashCheck: config.performance.trustedLocal });
          runId = env.run_id;
          appendTraceEvent(config, {
            span_id: env.id,
            run_id: runId,
            ts: new Date().toISOString(),
            actor: `svc:${opts.name}`,
            event: "recv_request",
            svc: opts.name,
            method: methodName
          });
          const result = await executeMethod(spec.methods[methodName], env.payload, config.requestTimeoutMs, {
            poolSize: config.runtime.workerPoolSize,
            maxPendingPerWorker: config.runtime.workerMaxPendingPerWorker
          });
          appendTraceEvent(config, {
            span_id: env.id,
            run_id: runId,
            ts: new Date().toISOString(),
            actor: `svc:${opts.name}`,
            event: "send_response",
            svc: opts.name,
            method: methodName,
            latency_ms: Date.now() - start
          });
          const replyEnv = createEnvelope({
            kind: "response",
            runId,
            payload: { ok: true, result },
            provenance: { service: opts.name, method: methodName }
          });
          msg.respond(encodeJson(replyEnv));
        } catch (err) {
          methodState.totalErrors += 1;
          const code = (err as { code?: string }).code ?? "INTERNAL";
          if (runId) {
            appendTraceEvent(config, {
              span_id: randomId(),
              run_id: runId,
              ts: new Date().toISOString(),
              actor: `svc:${opts.name}`,
              event: "error",
              svc: opts.name,
              method: methodName,
              error_code: code,
              detail: (err as Error).message
            });
          }
          const replyEnv = createEnvelope({
            kind: "response",
            runId: runId || randomId(),
            payload: { ok: false, error: { code, message: (err as Error).message } },
            provenance: { service: opts.name, method: methodName }
          });
          msg.respond(encodeJson(replyEnv));
        } finally {
          methodState.inflight -= 1;
          globalInflight -= 1;
          setImmediate(() => tryDrainMethod(methodName));
        }
      })();
    }
  };

  nc.publish(
    prefixedSubject(config, "discovery", "announce", opts.name),
    encodeJson(createEnvelope({ kind: "capability", payload: summary }))
  );

  logger.info("service adapter online", {
    service: opts.name,
    methods: methodNames.length,
    queue_group: opts.queueGroup,
    concurrency: opts.concurrency,
    per_method_limit: perMethodLimit,
    global_limit: globalLimit,
    queue_limit: queueLimit
  });

  for (const methodName of methodNames) {
    const methodState = methods.get(methodName);
    if (!methodState) continue;
    const sub = nc.subscribe(methodState.subject, opts.queueGroup ? { queue: opts.queueGroup } : undefined);
    (async () => {
      for await (const msg of sub) {
        if (methodState.queue.length >= queueLimit) {
          const replyEnv = createEnvelope({
            kind: "response",
            runId: randomId(),
            payload: { ok: false, error: { code: "OVERLOADED", message: "service queue capacity reached" } },
            provenance: { service: opts.name, method: methodName }
          });
          msg.respond(encodeJson(replyEnv));
          continue;
        }
        methodState.queue.push(msg);
        tryDrainMethod(methodName);
      }
    })().catch((err) => logger.error("subscription loop failed", { err: String(err), method: methodName }));
  }

  const inspectSub = nc.subscribe(prefixedSubject(config, "inspect", opts.name));
  (async () => {
    for await (const msg of inspectSub) {
      const env = createEnvelope({ kind: "capability", payload: summary, provenance: { service: opts.name } });
      msg.respond(encodeJson(env));
    }
  })().catch((err) => logger.error("inspect loop failed", { err: String(err) }));

  const serviceInfoPayload = () => ({
    type: "io.nats.micro.v1.info_response",
    name: opts.name,
    id: serviceInstanceId,
    version: spec.version ?? "0.0.0",
    description: spec.description ?? "",
    metadata: { orbit: "true", spec_path: opts.specPath },
    endpoints: methodNames.map((method) => ({
      name: method,
      subject: prefixedSubject(config, "rpc", opts.name, method),
      metadata: { orbit_method: method }
    }))
  });
  const servicePingPayload = () => ({
    type: "io.nats.micro.v1.ping_response",
    name: opts.name,
    id: serviceInstanceId,
    version: spec.version ?? "0.0.0",
    metadata: { orbit: "true" }
  });
  const serviceStatsPayload = () => ({
    type: "io.nats.micro.v1.stats_response",
    name: opts.name,
    id: serviceInstanceId,
    version: spec.version ?? "0.0.0",
    started: startedAt,
    endpoints: methodNames.map((method) => {
      const state = methods.get(method);
      return {
        name: method,
        subject: prefixedSubject(config, "rpc", opts.name, method),
        num_requests: state?.totalRequests ?? 0,
        num_errors: state?.totalErrors ?? 0
      };
    })
  });

  const pingSubs = [nc.subscribe("$SRV.PING"), nc.subscribe(`$SRV.PING.${opts.name}`), nc.subscribe("$SRV.PING.>")];
  for (const sub of pingSubs) {
    (async () => {
      for await (const msg of sub) {
        if (!matchesServiceApiSubject(msg.subject, "$SRV.PING", opts.name, serviceInstanceId)) continue;
        msg.respond(encodeJson(servicePingPayload()));
      }
    })().catch((err) => logger.error("service ping loop failed", { err: String(err) }));
  }

  const infoSubs = [nc.subscribe("$SRV.INFO"), nc.subscribe(`$SRV.INFO.${opts.name}`), nc.subscribe("$SRV.INFO.>")];
  for (const sub of infoSubs) {
    (async () => {
      for await (const msg of sub) {
        if (!matchesServiceApiSubject(msg.subject, "$SRV.INFO", opts.name, serviceInstanceId)) continue;
        msg.respond(encodeJson(serviceInfoPayload()));
      }
    })().catch((err) => logger.error("service info loop failed", { err: String(err) }));
  }

  const statsSubs = [nc.subscribe("$SRV.STATS"), nc.subscribe(`$SRV.STATS.${opts.name}`), nc.subscribe("$SRV.STATS.>")];
  for (const sub of statsSubs) {
    (async () => {
      for await (const msg of sub) {
        if (!matchesServiceApiSubject(msg.subject, "$SRV.STATS", opts.name, serviceInstanceId)) continue;
        msg.respond(encodeJson(serviceStatsPayload()));
      }
    })().catch((err) => logger.error("service stats loop failed", { err: String(err) }));
  }

  const discoverySub = nc.subscribe(prefixedSubject(config, "discovery", "query"));
  (async () => {
    for await (const msg of discoverySub) {
      try {
        const query = decodeJson(msg.data) as { service?: string };
        if (!query?.service || query.service === opts.name) {
          const env = createEnvelope({ kind: "capability", payload: summary, provenance: { service: opts.name } });
          msg.respond(encodeJson(env));
        }
      } catch {
        const env = createEnvelope({ kind: "capability", payload: summary, provenance: { service: opts.name } });
        msg.respond(encodeJson(env));
      }
    }
  })().catch((err) => logger.error("discovery loop failed", { err: String(err) }));

  await nc.closed();
}
