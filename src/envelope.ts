import crypto from "node:crypto";
import { OrbitError } from "./errors.js";
import { Envelope, EnvelopeKind } from "./types.js";
import { randomId, sha256, stableStringify } from "./util.js";

const SCHEMA_VERSION = "1.0";

export function hashEnvelopeFields(input: Omit<Envelope, "hash">): string {
  return sha256(stableStringify(input));
}

function signHash(hash: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(hash).digest("base64url");
}

function signHashEd25519(hash: string, privateKeyPem: string): string {
  return crypto.sign(null, Buffer.from(hash, "utf-8"), privateKeyPem).toString("base64url");
}

function verifyHashSignature(hash: string, secret: string, sig: string): boolean {
  const expected = signHash(hash, secret);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

function verifyHashSignatureEd25519(hash: string, publicKeyPem: string, sig: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(hash, "utf-8"), publicKeyPem, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}

export function createEnvelope(params: {
  kind: EnvelopeKind;
  payload: unknown;
  runId?: string;
  dataPack?: Envelope["data_pack"];
  provenance?: Record<string, unknown>;
  cost?: Record<string, number>;
  a2a?: Envelope["a2a"];
  nonce?: string;
  expiresAt?: string;
  ackId?: string;
  traceId?: string;
  signing?: {
    keyId: string;
    algorithm?: "hmac-sha256" | "ed25519";
    secret?: string;
    privateKeyPem?: string;
  };
}): Envelope {
  const base: Omit<Envelope, "hash"> = {
    id: randomId(),
    run_id: params.runId ?? randomId(),
    ts: new Date().toISOString(),
    kind: params.kind,
    schema_version: SCHEMA_VERSION,
    payload: params.payload,
    data_pack: params.dataPack,
    provenance: params.provenance,
    cost: params.cost,
    a2a: params.a2a,
    nonce: params.nonce,
    exp: params.expiresAt,
    ack_id: params.ackId,
    trace_id: params.traceId,
    kid: params.signing?.keyId,
    sig_alg: params.signing?.algorithm ?? (params.signing ? "hmac-sha256" : undefined),
    sig: undefined
  };
  const hash = hashEnvelopeFields(base);
  let sig: string | undefined;
  if (params.signing) {
    if ((params.signing.algorithm ?? "hmac-sha256") === "ed25519") {
      if (!params.signing.privateKeyPem) {
        throw new OrbitError("BAD_ARGS", "ed25519 signing requires privateKeyPem");
      }
      sig = signHashEd25519(hash, params.signing.privateKeyPem);
    } else {
      if (!params.signing.secret) {
        throw new OrbitError("BAD_ARGS", "hmac signing requires secret");
      }
      sig = signHash(hash, params.signing.secret);
    }
  }
  return { ...base, hash, sig };
}

function validateA2A(input: unknown): Envelope["a2a"] {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OrbitError("INVALID_ENVELOPE", "a2a must be an object");
  }
  const raw = input as Record<string, unknown>;
  const strOrUndefined = (value: unknown, field: string): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) {
      throw new OrbitError("INVALID_ENVELOPE", `a2a.${field} must be a non-empty string`);
    }
    return value;
  };
  if (raw.capabilities !== undefined) {
    if (!Array.isArray(raw.capabilities) || raw.capabilities.some((v) => typeof v !== "string" || !v)) {
      throw new OrbitError("INVALID_ENVELOPE", "a2a.capabilities must be a string[]");
    }
  }
  return {
    task_id: strOrUndefined(raw.task_id, "task_id"),
    thread_id: strOrUndefined(raw.thread_id, "thread_id"),
    parent_message_id: strOrUndefined(raw.parent_message_id, "parent_message_id"),
    capabilities: raw.capabilities as string[] | undefined,
    traceparent: strOrUndefined(raw.traceparent, "traceparent"),
    dedupe_key: strOrUndefined(raw.dedupe_key, "dedupe_key")
  };
}

export function validateEnvelope(
  input: unknown,
  options?: {
    skipHashCheck?: boolean;
    maxSkewMs?: number;
    nowMs?: number;
    requireSignature?: boolean;
    resolveSignatureSecret?: (kid: string) => string | undefined;
    resolveSignaturePublicKey?: (kid: string) => string | undefined;
  }
): Envelope {
  if (!input || typeof input !== "object") {
    throw new OrbitError("INVALID_ENVELOPE", "Envelope must be an object");
  }
  const env = input as Partial<Envelope>;
  const required: Array<keyof Envelope> = ["id", "run_id", "ts", "kind", "schema_version", "payload", "hash"];
  for (const key of required) {
    if (!(key in env)) throw new OrbitError("INVALID_ENVELOPE", `Missing envelope field: ${key}`);
  }
  if (typeof env.id !== "string" || !env.id) throw new OrbitError("INVALID_ENVELOPE", "id must be a string");
  if (typeof env.run_id !== "string" || !env.run_id) throw new OrbitError("INVALID_ENVELOPE", "run_id must be a string");
  if (typeof env.ts !== "string" || Number.isNaN(Date.parse(env.ts))) throw new OrbitError("INVALID_ENVELOPE", "ts must be ISO timestamp");
  if (typeof env.kind !== "string") throw new OrbitError("INVALID_ENVELOPE", "kind must be string");
  if (typeof env.schema_version !== "string") throw new OrbitError("INVALID_ENVELOPE", "schema_version must be string");
  if (typeof env.hash !== "string" || !env.hash) throw new OrbitError("INVALID_ENVELOPE", "hash must be string");
  if (env.nonce !== undefined && (typeof env.nonce !== "string" || !env.nonce)) {
    throw new OrbitError("INVALID_ENVELOPE", "nonce must be a non-empty string");
  }
  if (env.exp !== undefined && (typeof env.exp !== "string" || Number.isNaN(Date.parse(env.exp)))) {
    throw new OrbitError("INVALID_ENVELOPE", "exp must be ISO timestamp");
  }
  if (env.ack_id !== undefined && (typeof env.ack_id !== "string" || !env.ack_id)) {
    throw new OrbitError("INVALID_ENVELOPE", "ack_id must be a non-empty string");
  }
  if (env.trace_id !== undefined && (typeof env.trace_id !== "string" || !env.trace_id)) {
    throw new OrbitError("INVALID_ENVELOPE", "trace_id must be a non-empty string");
  }
  if (env.kid !== undefined && (typeof env.kid !== "string" || !env.kid)) {
    throw new OrbitError("INVALID_ENVELOPE", "kid must be a non-empty string");
  }
  if (env.sig_alg !== undefined && env.sig_alg !== "hmac-sha256" && env.sig_alg !== "ed25519") {
    throw new OrbitError("INVALID_ENVELOPE", "sig_alg must be hmac-sha256 or ed25519");
  }
  if (env.sig !== undefined && (typeof env.sig !== "string" || !env.sig)) {
    throw new OrbitError("INVALID_ENVELOPE", "sig must be a non-empty string");
  }

  const candidate: Omit<Envelope, "hash"> = {
    id: env.id,
    run_id: env.run_id,
    ts: env.ts,
    kind: env.kind as EnvelopeKind,
    schema_version: env.schema_version,
    payload: env.payload,
    data_pack: env.data_pack,
    provenance: env.provenance,
    cost: env.cost,
    a2a: validateA2A(env.a2a),
    nonce: env.nonce,
    exp: env.exp,
    ack_id: env.ack_id,
    trace_id: env.trace_id,
    kid: env.kid,
    sig_alg: env.sig_alg,
    sig: undefined
  };
  if (!options?.skipHashCheck && hashEnvelopeFields(candidate) !== env.hash) {
    throw new OrbitError("INVALID_ENVELOPE_HASH", "Envelope hash mismatch");
  }
  const nowMs = options?.nowMs ?? Date.now();
  const maxSkewMs = options?.maxSkewMs ?? 60_000;
  if (candidate.exp && Date.parse(candidate.exp) + maxSkewMs < nowMs) {
    throw new OrbitError("ENVELOPE_EXPIRED", "Envelope exp is in the past");
  }
  if (options?.requireSignature && (!env.sig || !env.kid)) {
    throw new OrbitError("ENVELOPE_SIGNATURE_REQUIRED", "Envelope signature is required");
  }
  if (env.sig) {
    if (!env.kid) {
      throw new OrbitError("INVALID_ENVELOPE", "sig requires kid");
    }
    const alg = env.sig_alg ?? "hmac-sha256";
    if (alg === "ed25519") {
      const publicKey = options?.resolveSignaturePublicKey?.(env.kid);
      if (!publicKey) {
        throw new OrbitError("UNKNOWN_SIGNER", `no trusted signing key for kid ${env.kid}`);
      }
      if (!verifyHashSignatureEd25519(env.hash, publicKey, env.sig)) {
        throw new OrbitError("INVALID_ENVELOPE_SIGNATURE", "Envelope signature mismatch");
      }
    } else {
      const secret = options?.resolveSignatureSecret?.(env.kid);
      if (!secret) {
        throw new OrbitError("UNKNOWN_SIGNER", `no trusted signing secret for kid ${env.kid}`);
      }
      if (!verifyHashSignature(env.hash, secret, env.sig)) {
        throw new OrbitError("INVALID_ENVELOPE_SIGNATURE", "Envelope signature mismatch");
      }
    }
  }
  return {
    ...(env as Envelope),
    a2a: candidate.a2a
  };
}
