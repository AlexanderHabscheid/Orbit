import { createEnvelope } from "../envelope.js";
import { OrbitError } from "../errors.js";
import { OrbitConfig } from "../types.js";
import { randomId } from "../util.js";
import { discoverSendEndpoint } from "./discovery.js";
import { assertDomainAllowed, extractDomain } from "./policy.js";
import { loadPrivateKeyPem } from "../identity/keys.js";
import { encryptJsonPayload } from "../security/e2ee.js";

export interface FederateSendInput {
  to: string;
  target: string;
  body: unknown;
  runId?: string;
  endpoint?: string;
  deliveryClass?: "best_effort" | "durable" | "auditable";
  timeoutMs?: number;
  taskId?: string;
  threadId?: string;
  parentMessageId?: string;
  traceparent?: string;
  dedupeKey?: string;
  e2eeKeyId?: string;
}

interface FederateSendResponse {
  ok: boolean;
  delivery_id?: string;
  error?: { code?: string; message?: string };
}

export async function sendFederatedMessage(config: OrbitConfig, input: FederateSendInput): Promise<unknown> {
  if (!config.federation.enabled) {
    throw new OrbitError("FORBIDDEN", "federation is disabled");
  }
  const domain = extractDomain(input.to);
  assertDomainAllowed(config, domain);

  const sendEndpoint = input.endpoint ?? (await discoverSendEndpoint(config, domain));
  const nowMs = Date.now();
  const expMs = nowMs + Math.max(1000, config.federation.requestTimeoutMs + 2000);
  const envelope = createEnvelope({
    kind: "request",
    runId: input.runId,
    payload:
      config.federation.e2ee.enabled && input.e2eeKeyId
        ? encryptJsonPayload(
            input.body,
            input.e2eeKeyId,
            config.federation.e2ee.keys[input.e2eeKeyId] ??
              (() => {
                throw new OrbitError("BAD_ARGS", `unknown e2ee key id ${input.e2eeKeyId}`);
              })()
          )
        : input.body,
    nonce: randomId(),
    expiresAt: new Date(expMs).toISOString(),
    ackId: randomId(),
    traceId: randomId(),
    a2a: {
      task_id: input.taskId,
      thread_id: input.threadId,
      parent_message_id: input.parentMessageId,
      traceparent: input.traceparent,
      dedupe_key: input.dedupeKey
    },
    signing:
      config.federation.signing.keyId
        ? {
            keyId: config.federation.signing.keyId,
            algorithm: config.federation.signing.algorithm,
            secret: config.federation.signing.algorithm === "hmac-sha256" ? config.federation.signing.secret : undefined,
            privateKeyPem:
              config.federation.signing.algorithm === "ed25519" ? loadPrivateKeyPem(config) : undefined
          }
        : undefined
  });

  const requestBody = {
    to: input.to,
    from: `orbit@${config.federation.localDomain}`,
    target: input.target,
    delivery_class: input.deliveryClass ?? config.federation.defaultDeliveryClass,
    envelope
  };

  const ac = new AbortController();
  const timeoutMs = input.timeoutMs ?? config.federation.requestTimeoutMs;
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(sendEndpoint, {
      method: "POST",
      signal: ac.signal,
      headers: {
        "content-type": "application/json",
        ...(config.federation.inboundAuthToken ? { authorization: `Bearer ${config.federation.inboundAuthToken}` } : {})
      },
      body: JSON.stringify(requestBody)
    });
    const json = (await res.json()) as FederateSendResponse;
    if (!res.ok || json.ok === false) {
      throw new OrbitError(
        json.error?.code ?? "FEDERATION_SEND_FAILED",
        json.error?.message ?? `remote federation request failed with status ${res.status}`
      );
    }
    return {
      ok: true,
      remote_domain: domain,
      endpoint: sendEndpoint,
      delivery_class: requestBody.delivery_class,
      envelope_id: envelope.id,
      delivery_id: json.delivery_id ?? envelope.ack_id
    };
  } catch (err) {
    if (err instanceof OrbitError) throw err;
    throw new OrbitError("FEDERATION_SEND_FAILED", `failed to send federated message to ${domain}`, { err });
  } finally {
    clearTimeout(timer);
  }
}
