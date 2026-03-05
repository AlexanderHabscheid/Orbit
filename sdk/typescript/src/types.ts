export type OrbitApiAction = "call" | "publish" | "inspect" | "ping" | "federate" | "bridge" | "abuse_report";

export interface OrbitApiErrorBody {
  code?: string;
  message?: string;
}

export interface OrbitApiResponseEnvelope<T = unknown> {
  id: string;
  ok: boolean;
  payload?: T;
  error?: OrbitApiErrorBody;
}

export interface OrbitClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface OrbitCallParams {
  target: string;
  body: unknown;
  timeoutMs?: number;
  retries?: number;
  runId?: string;
  packFile?: string;
  taskId?: string;
  threadId?: string;
  parentMessageId?: string;
  capabilities?: string[];
  traceparent?: string;
  dedupeKey?: string;
}

export interface OrbitPublishParams {
  topic: string;
  body: unknown;
  runId?: string;
  packFile?: string;
  durable?: boolean;
  dedupeKey?: string;
  taskId?: string;
  threadId?: string;
  parentMessageId?: string;
  capabilities?: string[];
  traceparent?: string;
}

export interface OrbitInspectParams {
  service: string;
  timeoutMs?: number;
}

export interface OrbitFederateParams {
  to: string;
  target: string;
  body: unknown;
  endpoint?: string;
  runId?: string;
  timeoutMs?: number;
  deliveryClass?: "best_effort" | "durable" | "auditable";
  e2eeKeyId?: string;
}

export interface OrbitBridgeParams {
  protocol: "a2a" | "mcp";
  message: Record<string, unknown>;
  dispatch?: boolean;
  to?: string;
  target?: string;
}

export interface OrbitAbuseReportParams {
  reporter: string;
  subject: string;
  reason: string;
  severity?: "low" | "medium" | "high" | "critical";
  evidence?: Record<string, unknown>;
}
