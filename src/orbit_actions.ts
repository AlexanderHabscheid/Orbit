import fs from "node:fs";
import { NatsConnection } from "nats";
import { createEnvelope, validateEnvelope } from "./envelope.js";
import { OrbitError } from "./errors.js";
import { decodeJson, encodeJson, osPut, publishSubject } from "./nats.js";
import { loadServiceRecordDistributed } from "./registry.js";
import { appendTraceEvent } from "./trace.js";
import { OrbitConfig } from "./types.js";
import { randomId } from "./util.js";
import { OrbitApiAction, validateActionPayload } from "./api_contract.js";
import { executeRpcCall } from "./rpc_call.js";
import { prefixedSubject } from "./subjects.js";

export async function executeOrbitAction(
  config: OrbitConfig,
  nc: NatsConnection,
  action: OrbitApiAction,
  payload: Record<string, unknown>,
  actor: "api" | "agent"
): Promise<unknown> {
  validateActionPayload(action, payload);
  switch (action) {
    case "ping":
      return { ok: true, now: new Date().toISOString() };
    case "call":
      return executeCall(config, nc, payload, actor);
    case "publish":
      return executePublish(config, nc, payload, actor);
    case "inspect":
      return executeInspect(config, nc, payload);
    default:
      throw new OrbitError("BAD_ARGS", `unknown action: ${String(action)}`);
  }
}

async function executeCall(
  config: OrbitConfig,
  nc: NatsConnection,
  payload: Record<string, unknown>,
  actor: "api" | "agent"
): Promise<unknown> {
  const target = String(payload.target ?? "");
  if (!target.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/)) {
    throw new OrbitError("BAD_TARGET", "target must be <service>.<method>");
  }
  return executeRpcCall(config, nc, {
    target,
    body: payload.body,
    timeoutMs: Number(payload.timeoutMs ?? config.requestTimeoutMs),
    retries: Number(payload.retries ?? config.retries),
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    packFile: typeof payload.packFile === "string" ? payload.packFile : undefined,
    a2a: {
      task_id: typeof payload.taskId === "string" ? payload.taskId : undefined,
      thread_id: typeof payload.threadId === "string" ? payload.threadId : undefined,
      parent_message_id: typeof payload.parentMessageId === "string" ? payload.parentMessageId : undefined,
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((v): v is string => typeof v === "string" && Boolean(v))
        : undefined,
      traceparent: typeof payload.traceparent === "string" ? payload.traceparent : undefined,
      dedupe_key: typeof payload.dedupeKey === "string" ? payload.dedupeKey : undefined
    },
    actor: `orbit-${actor}`,
    traceStartEvent: "call_start"
  });
}

async function executePublish(
  config: OrbitConfig,
  nc: NatsConnection,
  payload: Record<string, unknown>,
  actor: "api" | "agent"
): Promise<unknown> {
  const topic = String(payload.topic ?? "");
  if (!topic) throw new OrbitError("BAD_ARGS", "publish requires topic");
  const runId = typeof payload.runId === "string" ? payload.runId : randomId();
  const packFile = typeof payload.packFile === "string" ? payload.packFile : undefined;
  const dataPackRef = packFile
    ? {
        bucket: config.objectStoreBucket,
        key: `${runId}/pub/${Date.now()}-${randomId()}.bin`,
        bytes: fs.statSync(packFile).size
      }
    : undefined;
  if (packFile && dataPackRef) {
    await osPut(nc, dataPackRef.bucket, dataPackRef.key, fs.readFileSync(packFile), {
      description: `orbit event data pack for ${topic}`
    });
  }
  const env = createEnvelope({
    kind: "event",
    runId,
    payload: payload.body,
    dataPack: dataPackRef,
    provenance: { publisher: `orbit-${actor}`, topic },
    a2a: {
      task_id: typeof payload.taskId === "string" ? payload.taskId : undefined,
      thread_id: typeof payload.threadId === "string" ? payload.threadId : undefined,
      parent_message_id: typeof payload.parentMessageId === "string" ? payload.parentMessageId : undefined,
      capabilities: Array.isArray(payload.capabilities)
        ? payload.capabilities.filter((v): v is string => typeof v === "string" && Boolean(v))
        : undefined,
      traceparent: typeof payload.traceparent === "string" ? payload.traceparent : undefined,
      dedupe_key: typeof payload.dedupeKey === "string" ? payload.dedupeKey : undefined
    }
  });
  const durable = typeof payload.durable === "boolean" ? payload.durable : config.runtime.publishDurableEnabled;
  const dedupeKey =
    typeof payload.dedupeKey === "string" && payload.dedupeKey
      ? payload.dedupeKey
      : env.a2a?.dedupe_key;
  await publishSubject(nc, topic, encodeJson(env), {
    durable,
    dedupeKey,
    timeoutMs: config.runtime.publishDurableTimeoutMs
  });
  await nc.flush();
  return { ok: true, topic, run_id: runId, durable };
}

async function executeInspect(config: OrbitConfig, nc: NatsConnection, payload: Record<string, unknown>): Promise<unknown> {
  const service = String(payload.service ?? "");
  const timeoutMs = Number(payload.timeoutMs ?? config.requestTimeoutMs);
  if (!service) throw new OrbitError("BAD_ARGS", "inspect requires service");

  try {
    const msg = await nc.request(prefixedSubject(config, "inspect", service), encodeJson(createEnvelope({ kind: "request", payload: {} })), {
      timeout: timeoutMs
    });
    const env = validateEnvelope(decodeJson(msg.data), { skipHashCheck: config.performance.trustedLocal });
    return env.payload;
  } catch {
    try {
      const msg = await nc.request(`$SRV.INFO.${service}`, encodeJson({}), { timeout: timeoutMs });
      return decodeJson(msg.data);
    } catch {
      try {
        const msg = await nc.request(prefixedSubject(config, "discovery", "query"), encodeJson({ service }), { timeout: timeoutMs });
        const env = validateEnvelope(decodeJson(msg.data), { skipHashCheck: config.performance.trustedLocal });
        return env.payload;
      } catch {
        const local = await loadServiceRecordDistributed(config, service);
        if (!local) throw new OrbitError("NOT_FOUND", `service ${service} not found`);
        return local;
      }
    }
  }
}
