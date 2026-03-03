import { OrbitError } from "./errors.js";
import { Envelope, EnvelopeKind } from "./types.js";
import { randomId, sha256, stableStringify } from "./util.js";

const SCHEMA_VERSION = "1.0";

export function hashEnvelopeFields(input: Omit<Envelope, "hash">): string {
  return sha256(stableStringify(input));
}

export function createEnvelope(params: {
  kind: EnvelopeKind;
  payload: unknown;
  runId?: string;
  dataPack?: Envelope["data_pack"];
  provenance?: Record<string, unknown>;
  cost?: Record<string, number>;
  a2a?: Envelope["a2a"];
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
    a2a: params.a2a
  };
  return { ...base, hash: hashEnvelopeFields(base) };
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

export function validateEnvelope(input: unknown, options?: { skipHashCheck?: boolean }): Envelope {
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
    a2a: validateA2A(env.a2a)
  };
  if (!options?.skipHashCheck && hashEnvelopeFields(candidate) !== env.hash) {
    throw new OrbitError("INVALID_ENVELOPE_HASH", "Envelope hash mismatch");
  }
  return {
    ...(env as Envelope),
    a2a: candidate.a2a
  };
}
