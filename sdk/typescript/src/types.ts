export type OrbitApiAction = "call" | "publish" | "inspect" | "ping";

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
