import { OrbitError } from "./errors.js";
import { assertJsonSchema } from "./json_schema.js";

export type OrbitApiAction = "call" | "publish" | "inspect" | "ping";

export interface OrbitApiRequestEnvelope {
  id: string;
  action: OrbitApiAction;
  payload: Record<string, unknown>;
}

export interface OrbitApiResponseEnvelope {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
}

const ACTIONS = new Set<OrbitApiAction>(["call", "publish", "inspect", "ping"]);

export function isOrbitApiAction(value: string): value is OrbitApiAction {
  return ACTIONS.has(value as OrbitApiAction);
}

export function actionFromApiPath(pathname: string): OrbitApiAction | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  if (parts[0] !== "v1") return null;
  const action = parts[1];
  if (!isOrbitApiAction(action)) return null;
  return action;
}

export function parseObjectPayload(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new OrbitError("BAD_ARGS", "payload must be a JSON object");
  }
  return input as Record<string, unknown>;
}

const ACTION_PAYLOAD_SCHEMAS: Record<OrbitApiAction, Record<string, unknown>> = {
  ping: {
    type: "object",
    additionalProperties: false
  },
  call: {
    type: "object",
    required: ["target", "body"],
    additionalProperties: false,
    properties: {
      target: { type: "string", minLength: 3, pattern: "^[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+$" },
      body: {},
      timeoutMs: { type: "integer", minimum: 1 },
      retries: { type: "integer", minimum: 0 },
      runId: { type: "string", minLength: 1 },
      packFile: { type: "string", minLength: 1 },
      taskId: { type: "string", minLength: 1 },
      threadId: { type: "string", minLength: 1 },
      parentMessageId: { type: "string", minLength: 1 },
      capabilities: { type: "array", items: { type: "string", minLength: 1 } },
      traceparent: { type: "string", minLength: 1 },
      dedupeKey: { type: "string", minLength: 1 }
    }
  },
  publish: {
    type: "object",
    required: ["topic", "body"],
    additionalProperties: false,
    properties: {
      topic: { type: "string", minLength: 1 },
      body: {},
      runId: { type: "string", minLength: 1 },
      packFile: { type: "string", minLength: 1 },
      durable: { type: "boolean" },
      dedupeKey: { type: "string", minLength: 1 },
      taskId: { type: "string", minLength: 1 },
      threadId: { type: "string", minLength: 1 },
      parentMessageId: { type: "string", minLength: 1 },
      capabilities: { type: "array", items: { type: "string", minLength: 1 } },
      traceparent: { type: "string", minLength: 1 }
    }
  },
  inspect: {
    type: "object",
    required: ["service"],
    additionalProperties: false,
    properties: {
      service: { type: "string", minLength: 1 },
      timeoutMs: { type: "integer", minimum: 1 }
    }
  }
};

export function validateActionPayload(action: OrbitApiAction, payload: Record<string, unknown>): void {
  const schema = ACTION_PAYLOAD_SCHEMAS[action];
  if (!schema) throw new OrbitError("BAD_ARGS", `unsupported action ${action}`);
  assertJsonSchema(payload, schema, `action payload (${action})`);
}
