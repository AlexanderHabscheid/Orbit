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
import { sendFederatedMessage } from "./federation/transport.js";
import { normalizeBridgeMessage } from "./bridge/protocols.js";
import { fileAbuseReport } from "./reputation/abuse.js";

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
    case "federate":
      return executeFederate(config, payload);
    case "bridge":
      return executeBridge(config, nc, payload, actor);
    case "abuse_report":
      return executeAbuseReport(config, nc, payload);
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

async function executeFederate(config: OrbitConfig, payload: Record<string, unknown>): Promise<unknown> {
  return sendFederatedMessage(config, {
    to: String(payload.to ?? ""),
    target: String(payload.target ?? ""),
    body: payload.body,
    endpoint: typeof payload.endpoint === "string" ? payload.endpoint : undefined,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    timeoutMs: typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined,
    deliveryClass:
      payload.deliveryClass === "durable" || payload.deliveryClass === "auditable"
        ? payload.deliveryClass
        : payload.deliveryClass === "best_effort"
          ? payload.deliveryClass
          : undefined,
    taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
    threadId: typeof payload.threadId === "string" ? payload.threadId : undefined,
    parentMessageId: typeof payload.parentMessageId === "string" ? payload.parentMessageId : undefined,
    traceparent: typeof payload.traceparent === "string" ? payload.traceparent : undefined,
    dedupeKey: typeof payload.dedupeKey === "string" ? payload.dedupeKey : undefined,
    e2eeKeyId: typeof payload.e2eeKeyId === "string" ? payload.e2eeKeyId : undefined
  });
}

async function executeBridge(
  config: OrbitConfig,
  nc: NatsConnection,
  payload: Record<string, unknown>,
  actor: "api" | "agent"
): Promise<unknown> {
  const protocol = payload.protocol === "mcp" ? "mcp" : "a2a";
  const normalized = normalizeBridgeMessage({
    protocol,
    message: (payload.message ?? {}) as Record<string, unknown>
  });

  const dispatch = Boolean(payload.dispatch);
  if (!dispatch) {
    return {
      ok: true,
      protocol,
      normalized
    };
  }

  const to = typeof payload.to === "string" ? payload.to : undefined;
  const target = typeof payload.target === "string" ? payload.target : normalized.targetHint;
  if (to && target) {
    return sendFederatedMessage(config, {
      to,
      target,
      body: normalized.body,
      taskId: normalized.a2a?.task_id,
      threadId: normalized.a2a?.thread_id,
      parentMessageId: normalized.a2a?.parent_message_id,
      traceparent: normalized.a2a?.traceparent,
      dedupeKey: normalized.a2a?.dedupe_key
    });
  }

  const topic = prefixedSubject(config, "bridge", protocol, "ingress");
  const env = createEnvelope({
    kind: "event",
    payload: normalized.body,
    provenance: { bridge: protocol, actor: `orbit-${actor}` },
    a2a: normalized.a2a
  });
  await publishSubject(nc, topic, encodeJson(env), {
    durable: true,
    dedupeKey: env.a2a?.dedupe_key ?? env.id,
    timeoutMs: config.runtime.publishDurableTimeoutMs
  });
  await nc.flush();
  return { ok: true, protocol, topic, envelope_id: env.id };
}

async function executeAbuseReport(config: OrbitConfig, nc: NatsConnection, payload: Record<string, unknown>): Promise<unknown> {
  return fileAbuseReport(config, nc, {
    reporter: String(payload.reporter ?? ""),
    subject: String(payload.subject ?? ""),
    reason: String(payload.reason ?? ""),
    evidence: typeof payload.evidence === "object" && payload.evidence !== null
      ? (payload.evidence as Record<string, unknown>)
      : undefined,
    severity:
      payload.severity === "low" || payload.severity === "high" || payload.severity === "critical"
        ? payload.severity
        : payload.severity === "medium"
          ? payload.severity
          : undefined
  });
}
