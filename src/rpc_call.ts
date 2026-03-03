import fs from "node:fs";
import { NatsConnection } from "nats";
import { createEnvelope, validateEnvelope } from "./envelope.js";
import { withRetries } from "./retry.js";
import { decodeJson, encodeJson, osPut } from "./nats.js";
import { appendTraceEvent } from "./trace.js";
import { OrbitConfig } from "./types.js";
import { randomId } from "./util.js";
import { afterCallAttempt, beforeCall, onCallFailure, onCallSuccess } from "./call_protection.js";
import { prefixedSubject } from "./subjects.js";
import { OrbitError } from "./errors.js";
import { incCounter, observeHistogram } from "./metrics.js";

interface ExecuteRpcCallOptions {
  target: string;
  body: unknown;
  timeoutMs?: number;
  retries?: number;
  runId?: string;
  packFile?: string;
  a2a?: {
    task_id?: string;
    thread_id?: string;
    parent_message_id?: string;
    capabilities?: string[];
    traceparent?: string;
    dedupe_key?: string;
  };
  actor: string;
  traceStartEvent?: string;
}

export async function executeRpcCall(config: OrbitConfig, nc: NatsConnection, opts: ExecuteRpcCallOptions): Promise<unknown> {
  const m = opts.target.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
  if (!m) throw new OrbitError("BAD_TARGET", "target must be <service>.<method>");
  const [, svc, method] = m;
  const timeoutMs = opts.timeoutMs ?? config.requestTimeoutMs;
  const retries = opts.retries ?? config.retries;
  const runId = opts.runId ?? randomId();
  const dataPackRef = opts.packFile
    ? {
        bucket: config.objectStoreBucket,
        key: `${runId}/${svc}.${method}/${Date.now()}-${randomId()}.bin`,
        bytes: fs.statSync(opts.packFile).size
      }
    : undefined;
  if (opts.packFile && dataPackRef) {
    await osPut(nc, dataPackRef.bucket, dataPackRef.key, fs.readFileSync(opts.packFile), {
      description: `orbit data pack for ${svc}.${method}`
    });
  }

  const reqEnv = createEnvelope({
    kind: "request",
    runId,
    payload: opts.body,
    dataPack: dataPackRef,
    provenance: { caller: opts.actor, target: opts.target },
    a2a: opts.a2a
  });

  const spanId = reqEnv.id;
  appendTraceEvent(config, {
    span_id: spanId,
    run_id: runId,
    ts: new Date().toISOString(),
    actor: opts.actor,
    event: opts.traceStartEvent ?? "call_start",
    svc,
    method
  });

  const subject = prefixedSubject(config, "rpc", svc, method);
  const started = Date.now();

  beforeCall(config, opts.target);
  try {
    const { value, attempts } = await withRetries(
      async (attempt) => {
        const msg = await nc.request(subject, encodeJson(reqEnv), { timeout: timeoutMs });
        appendTraceEvent(config, {
          span_id: spanId,
          run_id: runId,
          ts: new Date().toISOString(),
          actor: opts.actor,
          event: "attempt_reply",
          svc,
          method,
          retry: attempt - 1
        });
        return msg;
      },
      {
        retries,
        timeoutMs,
        onRetry: (attempt, err) => {
          onCallFailure(config, opts.target);
          appendTraceEvent(config, {
            span_id: spanId,
            run_id: runId,
            ts: new Date().toISOString(),
            actor: opts.actor,
            event: "retry",
            svc,
            method,
            retry: attempt,
            error_code: (err as { code?: string }).code ?? "RETRY"
          });
        }
      }
    );

    const env = validateEnvelope(decodeJson(value.data), { skipHashCheck: config.performance.trustedLocal });
    const payload = env.payload as { ok?: boolean };
    if (payload?.ok === false) {
      onCallFailure(config, opts.target);
    } else {
      onCallSuccess(opts.target);
    }

    appendTraceEvent(config, {
      span_id: spanId,
      run_id: runId,
      ts: new Date().toISOString(),
      actor: opts.actor,
      event: "call_end",
      svc,
      method,
      latency_ms: Date.now() - started,
      retry: attempts - 1
    });
    const durationMs = Date.now() - started;
    observeHistogram("orbit_rpc_call_duration_ms", durationMs, { target: opts.target, outcome: "ok" });
    incCounter("orbit_rpc_calls_total", 1, { target: opts.target, outcome: "ok" });
    return env.payload;
  } catch (err) {
    onCallFailure(config, opts.target);
    const code = (err as { code?: string }).code ?? "ERROR";
    const durationMs = Date.now() - started;
    observeHistogram("orbit_rpc_call_duration_ms", durationMs, { target: opts.target, outcome: "error", code });
    incCounter("orbit_rpc_calls_total", 1, { target: opts.target, outcome: "error", code });
    throw err;
  } finally {
    afterCallAttempt(opts.target);
  }
}
