import { NatsConnection } from "nats";
import { validateEnvelope } from "../envelope.js";
import { OrbitError } from "../errors.js";
import { encodeJson, publishSubject } from "../nats.js";
import { prefixedSubject } from "../subjects.js";
import { Envelope, OrbitConfig } from "../types.js";
import { randomId } from "../util.js";
import { checkAndRememberNonce } from "./replay_guard.js";
import { resolveTrustedSigningSecret } from "./policy.js";
import { resolvePublicKeyPemByKid } from "../identity/jwks.js";
import { adjustDomainReputation } from "../reputation/store.js";
import { decryptJsonPayload, isEncryptedPayload } from "../security/e2ee.js";

interface FederationIngressPayload {
  from?: string;
  to?: string;
  target?: string;
  delivery_class?: "best_effort" | "durable" | "auditable";
  envelope?: unknown;
}

function parsePayload(input: Record<string, unknown>): FederationIngressPayload {
  return {
    from: typeof input.from === "string" ? input.from : undefined,
    to: typeof input.to === "string" ? input.to : undefined,
    target: typeof input.target === "string" ? input.target : undefined,
    delivery_class:
      input.delivery_class === "durable" || input.delivery_class === "auditable" ? input.delivery_class : "best_effort",
    envelope: input.envelope
  };
}

export async function handleFederationIngress(
  config: OrbitConfig,
  nc: NatsConnection,
  raw: Record<string, unknown>
): Promise<unknown> {
  if (!config.federation.enabled) {
    throw new OrbitError("FORBIDDEN", "federation is disabled");
  }
  const payload = parsePayload(raw);
  if (!payload.from || !payload.to || !payload.target || !payload.envelope) {
    throw new OrbitError("BAD_ARGS", "federation ingress requires from, to, target, envelope");
  }
  const incomingEnvelope = payload.envelope as Record<string, unknown>;
  const incomingKid = typeof incomingEnvelope.kid === "string" ? incomingEnvelope.kid : undefined;
  const incomingAlg = incomingEnvelope.sig_alg === "ed25519" ? "ed25519" : "hmac-sha256";
  const senderDomain = payload.from.includes("@") ? payload.from.slice(payload.from.lastIndexOf("@") + 1).toLowerCase() : undefined;
  const inboundPublicKey =
    incomingAlg === "ed25519" && incomingKid
      ? await resolvePublicKeyPemByKid(config, incomingKid, senderDomain)
      : undefined;

  const env = validateEnvelope(payload.envelope, {
    requireSignature: config.federation.signing.requireSignedInbound,
    resolveSignatureSecret: (kid) => resolveTrustedSigningSecret(config, kid),
    resolveSignaturePublicKey: (_kid) => inboundPublicKey
  });
  if (env.nonce && !checkAndRememberNonce(env.nonce, config.federation.replayWindowSec)) {
    adjustDomainReputation(config, senderDomain ?? "unknown", -10);
    throw new OrbitError("REPLAY_DETECTED", `envelope nonce ${env.nonce} has already been used`);
  }
  if (isEncryptedPayload(env.payload) && config.federation.e2ee.enabled) {
    const key = config.federation.e2ee.keys[env.payload.key_id];
    if (!key) {
      adjustDomainReputation(config, senderDomain ?? "unknown", -5);
      throw new OrbitError("BAD_ARGS", `missing e2ee key for ${env.payload.key_id}`);
    }
    env.payload = decryptJsonPayload(env.payload, key);
  }

  const subject = prefixedSubject(config, "federation", "inbound", payload.target.replaceAll(".", "_"));
  const wrapped: Record<string, unknown> = {
    id: randomId(),
    from: payload.from,
    to: payload.to,
    target: payload.target,
    delivery_class: payload.delivery_class,
    received_at: new Date().toISOString(),
    envelope: env as Envelope
  };
  const durable = payload.delivery_class !== "best_effort";
  await publishSubject(nc, subject, encodeJson(wrapped), {
    durable,
    dedupeKey: env.nonce ?? env.id,
    timeoutMs: config.runtime.publishDurableTimeoutMs
  });
  await nc.flush();
  adjustDomainReputation(config, senderDomain ?? "unknown", 2);
  return {
    ok: true,
    subject,
    delivery_id: env.ack_id ?? env.id,
    durable
  };
}
