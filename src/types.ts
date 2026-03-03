export type EnvelopeKind = "request" | "response" | "event" | "capability" | "trace";

export interface Envelope {
  id: string;
  run_id: string;
  ts: string;
  kind: EnvelopeKind;
  schema_version: string;
  payload: unknown;
  data_pack?: {
    bucket: string;
    key: string;
    bytes?: number;
    content_type?: string;
  };
  provenance?: Record<string, unknown>;
  cost?: Record<string, number>;
  a2a?: {
    task_id?: string;
    thread_id?: string;
    parent_message_id?: string;
    capabilities?: string[];
    traceparent?: string;
    dedupe_key?: string;
  };
  hash: string;
}

export interface ServiceMethodSpec {
  description?: string;
  request_schema?: Record<string, unknown>;
  response_schema?: Record<string, unknown>;
  command?: string;
  args?: string[];
  timeout_ms?: number;
  transport?: "spawn" | "worker" | "http";
  http_method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  http_endpoint?: string;
  headers?: Record<string, string>;
}

export interface ServiceSpec {
  service?: string;
  version?: string;
  description?: string;
  methods: Record<string, ServiceMethodSpec>;
}

export interface OrbitConfig {
  natsUrl: string;
  requestTimeoutMs: number;
  retries: number;
  logLevel: "debug" | "info" | "warn" | "error";
  dataDir: string;
  traceDir: string;
  servicesDir: string;
  activeContext: string;
  kvBucket: string;
  objectStoreBucket: string;
  otel: {
    endpoint?: string;
    serviceName: string;
  };
  performance: {
    mode: "balanced" | "hyper";
    traceSampleRate: number;
    trustedLocal: boolean;
    traceBufferMaxEvents: number;
    traceFlushIntervalMs: number;
  };
  routing: {
    subjectPrefix: string;
  };
  runtime: {
    serveMaxInflightGlobal: number;
    serveMaxInflightPerMethod: number;
    serveMaxQueueDepth: number;
    workerPoolSize: number;
    workerMaxPendingPerWorker: number;
    apiMaxConcurrent: number;
    apiMaxBodyBytes: number;
    apiRequestTimeoutMs: number;
    agentMaxConcurrent: number;
    agentMaxRequestBytes: number;
    publishDurableEnabled: boolean;
    publishDurableTimeoutMs: number;
    callRateLimitPerSec: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerCooldownMs: number;
    circuitBreakerHalfOpenMax: number;
    monitorMaxParallel: number;
    monitorJitterMs: number;
    monitorDownBackoffFactor: number;
    monitorDownBackoffMaxMs: number;
  };
  api: {
    authToken?: string;
    allowedHosts: string[];
    tls: {
      enabled: boolean;
      certFile?: string;
      keyFile?: string;
      caFile?: string;
      requestClientCert: boolean;
      requireClientCert: boolean;
    };
  };
  agent: {
    enabled: boolean;
    socketPath: string;
  };
  broker: {
    host: string;
    port: number;
    dockerImage: string;
    containerName: string;
  };
}

export interface TraceEvent {
  span_id: string;
  parent_span_id?: string;
  run_id: string;
  ts: string;
  actor: string;
  event: string;
  svc?: string;
  method?: string;
  latency_ms?: number;
  retry?: number;
  error_code?: string;
  detail?: string;
}

export interface OrbitContext {
  natsUrl: string;
  requestTimeoutMs: number;
  retries: number;
}
