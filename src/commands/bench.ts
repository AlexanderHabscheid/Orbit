import { createEnvelope, validateEnvelope } from "../envelope.js";
import { OrbitError } from "../errors.js";
import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson, encodeJson } from "../nats.js";
import { withRetries } from "../retry.js";
import { appendTraceEvent } from "../trace.js";
import { OrbitConfig } from "../types.js";
import { randomId } from "../util.js";
import { prefixedSubject } from "../subjects.js";

function percentile(input: number[], p: number): number {
  if (input.length === 0) return 0;
  const sorted = [...input].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export async function cmdBench(
  config: OrbitConfig,
  _logger: Logger,
  opts: {
    target: string;
    body: unknown;
    durationSec: number;
    concurrency: number;
    rampToConcurrency?: number;
    rampStepSec?: number;
    rampStepConcurrency?: number;
    timeoutMs?: number;
    retries?: number;
  }
): Promise<void> {
  const match = opts.target.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
  if (!match) throw new OrbitError("BAD_TARGET", "target must be <service>.<method>");
  const [, svc, method] = match;
  const subject = prefixedSubject(config, "rpc", svc, method);
  const timeoutMs = opts.timeoutMs ?? config.requestTimeoutMs;
  const retries = opts.retries ?? config.retries;
  const durationMs = Math.max(1, Math.floor(opts.durationSec * 1000));
  const baseConcurrency = Math.max(1, Math.floor(opts.concurrency));
  const rampTo = opts.rampToConcurrency ? Math.max(baseConcurrency, Math.floor(opts.rampToConcurrency)) : baseConcurrency;
  const maxWorkers = rampTo;
  const rampStepSec = Math.max(1, Math.floor(opts.rampStepSec ?? 1));
  const rampStepConcurrency = Math.max(1, Math.floor(opts.rampStepConcurrency ?? 1));
  const nc = await connectBus(config.natsUrl);

  const runId = randomId();
  const start = Date.now();
  const stopAt = start + durationMs;
  let total = 0;
  let success = 0;
  let failed = 0;
  const latencies: number[] = [];

  appendTraceEvent(config, {
    span_id: randomId(),
    run_id: runId,
    ts: new Date().toISOString(),
    actor: "bench",
    event: "bench_start",
    svc,
    method,
    detail: `duration_ms=${durationMs},concurrency=${baseConcurrency},ramp_to=${rampTo}`
  });

  let activeWorkers = baseConcurrency;
  if (rampTo > baseConcurrency) {
    const rampTimer = setInterval(() => {
      activeWorkers = Math.min(rampTo, activeWorkers + rampStepConcurrency);
      if (activeWorkers >= rampTo) clearInterval(rampTimer);
    }, rampStepSec * 1000);
    rampTimer.unref?.();
  }

  const worker = async (index: number) => {
    while (Date.now() < stopAt) {
      if (index >= activeWorkers) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      const callStart = Date.now();
      total += 1;
      try {
        const reqEnv = createEnvelope({
          kind: "request",
          runId,
          payload: opts.body,
          provenance: { caller: "orbit-bench", target: opts.target }
        });
        const { value } = await withRetries(
          async () => nc.request(subject, encodeJson(reqEnv), { timeout: timeoutMs }),
          { retries, timeoutMs }
        );
        const reply = validateEnvelope(decodeJson(value.data), { skipHashCheck: config.performance.trustedLocal });
        const payload = reply.payload as { ok?: boolean };
        if (payload?.ok === false) {
          failed += 1;
        } else {
          success += 1;
          latencies.push(Date.now() - callStart);
        }
      } catch {
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: maxWorkers }, (_v, idx) => worker(idx)));
  await closeBus(config.natsUrl);

  const elapsedMs = Math.max(1, Date.now() - start);
  const result = {
    ok: true,
    target: opts.target,
    duration_ms: elapsedMs,
    concurrency: {
      start: baseConcurrency,
      max: rampTo,
      ramp_step_sec: rampTo > baseConcurrency ? rampStepSec : null,
      ramp_step_concurrency: rampTo > baseConcurrency ? rampStepConcurrency : null
    },
    total_requests: total,
    success,
    failed,
    error_rate: total === 0 ? 0 : failed / total,
    throughput_rps: Number(((total * 1000) / elapsedMs).toFixed(2)),
    latency_ms: {
      min: latencies.length ? Math.min(...latencies) : 0,
      avg: latencies.length ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)) : 0,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : 0
    }
  };
  appendTraceEvent(config, {
    span_id: randomId(),
    run_id: runId,
    ts: new Date().toISOString(),
    actor: "bench",
    event: "bench_end",
    svc,
    method,
    detail: JSON.stringify(result)
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
