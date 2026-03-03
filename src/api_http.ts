import { OrbitError } from "./errors.js";

export interface ApiErrorBody {
  type: "orbit_error";
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  id: string;
  ok: false;
  error: ApiErrorBody;
}

export interface ApiSuccessResponse {
  id: string;
  ok: true;
  payload: unknown;
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isOrbitError(err: unknown): err is OrbitError {
  return err instanceof OrbitError;
}

function statusForCode(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "FORBIDDEN_BIND_HOST":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "REQUEST_TIMEOUT":
    case "TIMEOUT":
    case "METHOD_TIMEOUT":
      return 408;
    case "PAYLOAD_TOO_LARGE":
    case "REQUEST_TOO_LARGE":
    case "AGENT_PAYLOAD_TOO_LARGE":
      return 413;
    case "RATE_LIMITED":
    case "CIRCUIT_OPEN":
    case "OVERLOADED":
    case "API_OVERLOADED":
    case "AGENT_OVERLOADED":
      return 429;
    case "METHOD_NOT_ALLOWED":
      return 405;
    case "BAD_ARGS":
    case "BAD_TARGET":
    case "BAD_JSON":
    case "BAD_JSON_INPUT":
    case "INVALID_SPEC":
    case "SCHEMA_VALIDATION_FAILED":
      return 400;
    default:
      return 500;
  }
}

export function normalizeApiError(err: unknown): ApiHttpError {
  if (err instanceof ApiHttpError) return err;
  if (isOrbitError(err)) {
    return new ApiHttpError(statusForCode(err.code), err.code, err.message, err.details);
  }
  const maybe = err as { code?: string; message?: string; details?: unknown };
  const code = typeof maybe.code === "string" ? maybe.code : "API_ERROR";
  const message = typeof maybe.message === "string" && maybe.message.length > 0 ? maybe.message : "internal API error";
  return new ApiHttpError(statusForCode(code), code, message, maybe.details);
}
