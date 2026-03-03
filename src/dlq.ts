import { OrbitError } from "./errors.js";

export interface DlqFilter {
  fromTsMs?: number;
  toTsMs?: number;
  errorCode?: string;
  sourceConsumer?: string;
}

export interface DlqRecordMeta {
  failedAt?: string;
  failedAtMs?: number;
  sourceTopic?: string;
  sourceStream?: string;
  sourceConsumer?: string;
  deliveryCount?: number;
  error?: string;
  errorCode?: string;
}

function toMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return ms;
}

export function parseOptionalIsoTs(value: string | undefined, fieldName: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new OrbitError("BAD_ARGS", `${fieldName} must be an ISO-8601 timestamp`);
  }
  return ms;
}

export function normalizeErrorCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim();
  if (!cleaned) return undefined;
  return cleaned.toUpperCase();
}

function inferErrorCodeFromMessage(error: string | undefined): string | undefined {
  if (!error) return undefined;
  const m = error.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
  return m?.[1];
}

export function extractDlqMeta(input: unknown, fallbackTs?: string): DlqRecordMeta {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { failedAt: fallbackTs, failedAtMs: toMs(fallbackTs) };
  }
  const raw = input as Record<string, unknown>;
  const src = raw.source && typeof raw.source === "object" ? (raw.source as Record<string, unknown>) : undefined;
  const failedAt = typeof raw.failed_at === "string" ? raw.failed_at : fallbackTs;
  const error = src && typeof src.error === "string" ? src.error : undefined;
  const explicitCode = src && typeof src.error_code === "string" ? src.error_code : undefined;
  return {
    failedAt,
    failedAtMs: toMs(failedAt),
    sourceTopic: src && typeof src.topic === "string" ? src.topic : undefined,
    sourceStream: src && typeof src.stream === "string" ? src.stream : undefined,
    sourceConsumer: src && typeof src.consumer === "string" ? src.consumer : undefined,
    deliveryCount: src && typeof src.delivery_count === "number" ? src.delivery_count : undefined,
    error,
    errorCode: normalizeErrorCode(explicitCode) ?? normalizeErrorCode(inferErrorCodeFromMessage(error))
  };
}

export function matchesDlqFilter(meta: DlqRecordMeta, filter: DlqFilter): boolean {
  if (filter.fromTsMs !== undefined) {
    if (meta.failedAtMs === undefined || meta.failedAtMs < filter.fromTsMs) return false;
  }
  if (filter.toTsMs !== undefined) {
    if (meta.failedAtMs === undefined || meta.failedAtMs > filter.toTsMs) return false;
  }
  if (filter.errorCode) {
    if (normalizeErrorCode(meta.errorCode) !== normalizeErrorCode(filter.errorCode)) return false;
  }
  if (filter.sourceConsumer) {
    if (meta.sourceConsumer !== filter.sourceConsumer) return false;
  }
  return true;
}
