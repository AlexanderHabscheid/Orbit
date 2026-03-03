import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { OrbitConfig, OrbitContext } from "./types.js";
import { ensureDir, expandHome, readJsonFile, writeJsonFile } from "./util.js";

export const HOME_ORBIT = path.join(os.homedir(), ".orbit");
export const USER_CONFIG_PATH = path.join(HOME_ORBIT, "config.json");

function maybeReadObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  return readJsonFile<Record<string, unknown>>(filePath);
}

function fromObject(obj: Record<string, unknown>): Partial<OrbitConfig> {
  const out: Partial<OrbitConfig> = {};
  if (typeof obj.natsUrl === "string") out.natsUrl = obj.natsUrl;
  if (typeof obj.requestTimeoutMs === "number") out.requestTimeoutMs = obj.requestTimeoutMs;
  if (typeof obj.retries === "number") out.retries = obj.retries;
  if (typeof obj.logLevel === "string") out.logLevel = obj.logLevel as OrbitConfig["logLevel"];
  if (typeof obj.dataDir === "string") out.dataDir = obj.dataDir;
  if (typeof obj.activeContext === "string") out.activeContext = obj.activeContext;
  if (typeof obj.kvBucket === "string") out.kvBucket = obj.kvBucket;
  if (typeof obj.objectStoreBucket === "string") out.objectStoreBucket = obj.objectStoreBucket;
  if (obj.otel && typeof obj.otel === "object") {
    const otelRaw = obj.otel as Record<string, unknown>;
    out.otel = {
      endpoint: typeof otelRaw.endpoint === "string" ? otelRaw.endpoint : undefined,
      serviceName: typeof otelRaw.serviceName === "string" ? otelRaw.serviceName : "orbit-cli"
    };
  }
  if (obj.performance && typeof obj.performance === "object") {
    const perfRaw = obj.performance as Record<string, unknown>;
    out.performance = {
      mode: perfRaw.mode === "hyper" ? "hyper" : "balanced",
      traceSampleRate: typeof perfRaw.traceSampleRate === "number" ? perfRaw.traceSampleRate : 1,
      trustedLocal: typeof perfRaw.trustedLocal === "boolean" ? perfRaw.trustedLocal : false,
      traceBufferMaxEvents: typeof perfRaw.traceBufferMaxEvents === "number" ? perfRaw.traceBufferMaxEvents : 5000,
      traceFlushIntervalMs: typeof perfRaw.traceFlushIntervalMs === "number" ? perfRaw.traceFlushIntervalMs : 25
    };
  }
  if (obj.routing && typeof obj.routing === "object") {
    const routingRaw = obj.routing as Record<string, unknown>;
    out.routing = {
      subjectPrefix: typeof routingRaw.subjectPrefix === "string" ? routingRaw.subjectPrefix : "orbit"
    };
  }
  if (obj.runtime && typeof obj.runtime === "object") {
    const runtimeRaw = obj.runtime as Record<string, unknown>;
    out.runtime = {
      serveMaxInflightGlobal:
        typeof runtimeRaw.serveMaxInflightGlobal === "number" ? runtimeRaw.serveMaxInflightGlobal : 64,
      serveMaxInflightPerMethod:
        typeof runtimeRaw.serveMaxInflightPerMethod === "number" ? runtimeRaw.serveMaxInflightPerMethod : 16,
      serveMaxQueueDepth: typeof runtimeRaw.serveMaxQueueDepth === "number" ? runtimeRaw.serveMaxQueueDepth : 256,
      workerPoolSize: typeof runtimeRaw.workerPoolSize === "number" ? runtimeRaw.workerPoolSize : 2,
      workerMaxPendingPerWorker:
        typeof runtimeRaw.workerMaxPendingPerWorker === "number" ? runtimeRaw.workerMaxPendingPerWorker : 64,
      apiMaxConcurrent: typeof runtimeRaw.apiMaxConcurrent === "number" ? runtimeRaw.apiMaxConcurrent : 128,
      apiMaxBodyBytes: typeof runtimeRaw.apiMaxBodyBytes === "number" ? runtimeRaw.apiMaxBodyBytes : 1_048_576,
      apiRequestTimeoutMs:
        typeof runtimeRaw.apiRequestTimeoutMs === "number" ? runtimeRaw.apiRequestTimeoutMs : 15_000,
      agentMaxConcurrent: typeof runtimeRaw.agentMaxConcurrent === "number" ? runtimeRaw.agentMaxConcurrent : 128,
      agentMaxRequestBytes:
        typeof runtimeRaw.agentMaxRequestBytes === "number" ? runtimeRaw.agentMaxRequestBytes : 262_144,
      publishDurableEnabled:
        typeof runtimeRaw.publishDurableEnabled === "boolean" ? runtimeRaw.publishDurableEnabled : false,
      publishDurableTimeoutMs:
        typeof runtimeRaw.publishDurableTimeoutMs === "number" ? runtimeRaw.publishDurableTimeoutMs : 2_500,
      callRateLimitPerSec: typeof runtimeRaw.callRateLimitPerSec === "number" ? runtimeRaw.callRateLimitPerSec : 0,
      circuitBreakerFailureThreshold:
        typeof runtimeRaw.circuitBreakerFailureThreshold === "number" ? runtimeRaw.circuitBreakerFailureThreshold : 5,
      circuitBreakerCooldownMs:
        typeof runtimeRaw.circuitBreakerCooldownMs === "number" ? runtimeRaw.circuitBreakerCooldownMs : 10_000,
      circuitBreakerHalfOpenMax:
        typeof runtimeRaw.circuitBreakerHalfOpenMax === "number" ? runtimeRaw.circuitBreakerHalfOpenMax : 1,
      monitorMaxParallel: typeof runtimeRaw.monitorMaxParallel === "number" ? runtimeRaw.monitorMaxParallel : 8,
      monitorJitterMs: typeof runtimeRaw.monitorJitterMs === "number" ? runtimeRaw.monitorJitterMs : 200,
      monitorDownBackoffFactor:
        typeof runtimeRaw.monitorDownBackoffFactor === "number" ? runtimeRaw.monitorDownBackoffFactor : 1.6,
      monitorDownBackoffMaxMs:
        typeof runtimeRaw.monitorDownBackoffMaxMs === "number" ? runtimeRaw.monitorDownBackoffMaxMs : 15_000
    };
  }
  if (obj.agent && typeof obj.agent === "object") {
    const agentRaw = obj.agent as Record<string, unknown>;
    out.agent = {
      enabled: typeof agentRaw.enabled === "boolean" ? agentRaw.enabled : true,
      socketPath: typeof agentRaw.socketPath === "string" ? agentRaw.socketPath : ""
    };
  }
  if (obj.api && typeof obj.api === "object") {
    const apiRaw = obj.api as Record<string, unknown>;
    const tlsRaw = apiRaw.tls && typeof apiRaw.tls === "object" ? (apiRaw.tls as Record<string, unknown>) : {};
    out.api = {
      authToken: typeof apiRaw.authToken === "string" ? apiRaw.authToken : undefined,
      allowedHosts: Array.isArray(apiRaw.allowedHosts) ? apiRaw.allowedHosts.filter((v): v is string => typeof v === "string") : [],
      tls: {
        enabled: typeof tlsRaw.enabled === "boolean" ? tlsRaw.enabled : false,
        certFile: typeof tlsRaw.certFile === "string" ? tlsRaw.certFile : undefined,
        keyFile: typeof tlsRaw.keyFile === "string" ? tlsRaw.keyFile : undefined,
        caFile: typeof tlsRaw.caFile === "string" ? tlsRaw.caFile : undefined,
        requestClientCert: typeof tlsRaw.requestClientCert === "boolean" ? tlsRaw.requestClientCert : false,
        requireClientCert: typeof tlsRaw.requireClientCert === "boolean" ? tlsRaw.requireClientCert : false
      }
    };
  }
  return out;
}

function resolveContext(
  activeContext: string,
  contexts: Record<string, OrbitContext> | undefined,
  defaults: OrbitContext
): OrbitContext {
  if (!contexts) return defaults;
  return contexts[activeContext] ?? defaults;
}

export function loadConfig(cwd: string): OrbitConfig {
  const envAllowedHosts = (process.env.ORBIT_API_ALLOWED_HOSTS ?? "127.0.0.1,localhost,::1")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const defaultContext: OrbitContext = {
    natsUrl: process.env.ORBIT_NATS_URL ?? "nats://127.0.0.1:4222",
    requestTimeoutMs: Number(process.env.ORBIT_TIMEOUT_MS ?? "5000"),
    retries: Number(process.env.ORBIT_RETRIES ?? "2")
  };

  const defaults: OrbitConfig = {
    ...defaultContext,
    logLevel: (process.env.ORBIT_LOG_LEVEL as OrbitConfig["logLevel"]) ?? "info",
    dataDir: process.env.ORBIT_DATA_DIR ?? HOME_ORBIT,
    traceDir: "",
    servicesDir: "",
    activeContext: process.env.ORBIT_CONTEXT ?? "default",
    kvBucket: process.env.ORBIT_KV_BUCKET ?? "orbit_registry",
    objectStoreBucket: process.env.ORBIT_OBJECT_BUCKET ?? "orbit_datapacks",
    otel: {
      endpoint: process.env.ORBIT_OTEL_ENDPOINT,
      serviceName: process.env.ORBIT_OTEL_SERVICE ?? "orbit-cli"
    },
    performance: {
      mode: process.env.ORBIT_PERF_MODE === "hyper" ? "hyper" : "balanced",
      traceSampleRate: Number(process.env.ORBIT_TRACE_SAMPLE_RATE ?? "0.2"),
      trustedLocal: process.env.ORBIT_TRUSTED_LOCAL === "1",
      traceBufferMaxEvents: Number(process.env.ORBIT_TRACE_BUFFER_MAX_EVENTS ?? "5000"),
      traceFlushIntervalMs: Number(process.env.ORBIT_TRACE_FLUSH_INTERVAL_MS ?? "25")
    },
    routing: {
      subjectPrefix: process.env.ORBIT_SUBJECT_PREFIX ?? "orbit"
    },
    api: {
      authToken: process.env.ORBIT_API_TOKEN,
      allowedHosts: envAllowedHosts,
      tls: {
        enabled: process.env.ORBIT_API_TLS_ENABLED === "1",
        certFile: process.env.ORBIT_API_TLS_CERT_FILE,
        keyFile: process.env.ORBIT_API_TLS_KEY_FILE,
        caFile: process.env.ORBIT_API_TLS_CA_FILE,
        requestClientCert: process.env.ORBIT_API_TLS_REQUEST_CLIENT_CERT === "1",
        requireClientCert: process.env.ORBIT_API_TLS_REQUIRE_CLIENT_CERT === "1"
      }
    },
    runtime: {
      serveMaxInflightGlobal: Number(process.env.ORBIT_SERVE_MAX_INFLIGHT_GLOBAL ?? "64"),
      serveMaxInflightPerMethod: Number(process.env.ORBIT_SERVE_MAX_INFLIGHT_PER_METHOD ?? "16"),
      serveMaxQueueDepth: Number(process.env.ORBIT_SERVE_MAX_QUEUE_DEPTH ?? "256"),
      workerPoolSize: Number(process.env.ORBIT_WORKER_POOL_SIZE ?? "2"),
      workerMaxPendingPerWorker: Number(process.env.ORBIT_WORKER_MAX_PENDING ?? "64"),
      apiMaxConcurrent: Number(process.env.ORBIT_API_MAX_CONCURRENT ?? "128"),
      apiMaxBodyBytes: Number(process.env.ORBIT_API_MAX_BODY_BYTES ?? "1048576"),
      apiRequestTimeoutMs: Number(process.env.ORBIT_API_REQUEST_TIMEOUT_MS ?? "15000"),
      agentMaxConcurrent: Number(process.env.ORBIT_AGENT_MAX_CONCURRENT ?? "128"),
      agentMaxRequestBytes: Number(process.env.ORBIT_AGENT_MAX_REQUEST_BYTES ?? "262144"),
      publishDurableEnabled: process.env.ORBIT_PUBLISH_DURABLE_ENABLED === "1",
      publishDurableTimeoutMs: Number(process.env.ORBIT_PUBLISH_DURABLE_TIMEOUT_MS ?? "2500"),
      callRateLimitPerSec: Number(process.env.ORBIT_CALL_RATE_LIMIT_PER_SEC ?? "0"),
      circuitBreakerFailureThreshold: Number(process.env.ORBIT_CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? "5"),
      circuitBreakerCooldownMs: Number(process.env.ORBIT_CIRCUIT_BREAKER_COOLDOWN_MS ?? "10000"),
      circuitBreakerHalfOpenMax: Number(process.env.ORBIT_CIRCUIT_BREAKER_HALF_OPEN_MAX ?? "1"),
      monitorMaxParallel: Number(process.env.ORBIT_MONITOR_MAX_PARALLEL ?? "8"),
      monitorJitterMs: Number(process.env.ORBIT_MONITOR_JITTER_MS ?? "200"),
      monitorDownBackoffFactor: Number(process.env.ORBIT_MONITOR_DOWN_BACKOFF_FACTOR ?? "1.6"),
      monitorDownBackoffMaxMs: Number(process.env.ORBIT_MONITOR_DOWN_BACKOFF_MAX_MS ?? "15000")
    },
    agent: {
      enabled: process.env.ORBIT_AGENT_ENABLED ? process.env.ORBIT_AGENT_ENABLED === "1" : true,
      socketPath: process.env.ORBIT_AGENT_SOCKET ?? ""
    },
    broker: {
      host: process.env.ORBIT_NATS_HOST ?? "127.0.0.1",
      port: Number(process.env.ORBIT_NATS_PORT ?? "4222"),
      dockerImage: process.env.ORBIT_NATS_IMAGE ?? "nats:2",
      containerName: process.env.ORBIT_NATS_CONTAINER ?? "orbit-nats"
    }
  };

  const userConfigPath = USER_CONFIG_PATH;
  const localConfigPath = path.join(cwd, ".orbit", "config.json");
  const userObj = maybeReadObject(userConfigPath);
  const localObj = maybeReadObject(localConfigPath);
  const merged = {
    ...defaults,
    ...fromObject(userObj),
    ...fromObject(localObj)
  };
  const contexts = {
    ...(userObj.contexts as Record<string, OrbitContext> | undefined),
    ...(localObj.contexts as Record<string, OrbitContext> | undefined)
  };
  const ctx = resolveContext(merged.activeContext ?? "default", contexts, defaultContext);

  const dataDir = merged.dataDir ?? defaults.dataDir;
  const finalConfig: OrbitConfig = {
    ...defaults,
    ...merged,
    natsUrl: ctx.natsUrl,
    requestTimeoutMs: ctx.requestTimeoutMs,
    retries: ctx.retries,
    dataDir,
    traceDir: path.join(dataDir, "traces"),
    servicesDir: path.join(dataDir, "services"),
    performance: {
      mode: merged.performance?.mode ?? defaults.performance.mode,
      traceSampleRate: Math.max(0, Math.min(1, merged.performance?.traceSampleRate ?? defaults.performance.traceSampleRate)),
      trustedLocal: merged.performance?.trustedLocal ?? defaults.performance.trustedLocal,
      traceBufferMaxEvents: Math.max(
        100,
        Math.floor(merged.performance?.traceBufferMaxEvents ?? defaults.performance.traceBufferMaxEvents)
      ),
      traceFlushIntervalMs: Math.max(
        1,
        Math.floor(merged.performance?.traceFlushIntervalMs ?? defaults.performance.traceFlushIntervalMs)
      )
    },
    routing: {
      subjectPrefix: (merged.routing?.subjectPrefix ?? defaults.routing.subjectPrefix).trim() || "orbit"
    },
    api: {
      authToken: merged.api?.authToken ?? defaults.api.authToken,
      allowedHosts: (merged.api?.allowedHosts ?? defaults.api.allowedHosts).map((v) => v.trim()).filter(Boolean),
      tls: {
        enabled: merged.api?.tls?.enabled ?? defaults.api.tls.enabled,
        certFile: (merged.api?.tls?.certFile ?? defaults.api.tls.certFile)
          ? expandHome(merged.api?.tls?.certFile ?? defaults.api.tls.certFile ?? "")
          : undefined,
        keyFile: (merged.api?.tls?.keyFile ?? defaults.api.tls.keyFile)
          ? expandHome(merged.api?.tls?.keyFile ?? defaults.api.tls.keyFile ?? "")
          : undefined,
        caFile: (merged.api?.tls?.caFile ?? defaults.api.tls.caFile)
          ? expandHome(merged.api?.tls?.caFile ?? defaults.api.tls.caFile ?? "")
          : undefined,
        requestClientCert: merged.api?.tls?.requestClientCert ?? defaults.api.tls.requestClientCert,
        requireClientCert: merged.api?.tls?.requireClientCert ?? defaults.api.tls.requireClientCert
      }
    },
    runtime: {
      serveMaxInflightGlobal: Math.max(
        1,
        Math.floor(merged.runtime?.serveMaxInflightGlobal ?? defaults.runtime.serveMaxInflightGlobal)
      ),
      serveMaxInflightPerMethod: Math.max(
        1,
        Math.floor(merged.runtime?.serveMaxInflightPerMethod ?? defaults.runtime.serveMaxInflightPerMethod)
      ),
      serveMaxQueueDepth: Math.max(1, Math.floor(merged.runtime?.serveMaxQueueDepth ?? defaults.runtime.serveMaxQueueDepth)),
      workerPoolSize: Math.max(1, Math.floor(merged.runtime?.workerPoolSize ?? defaults.runtime.workerPoolSize)),
      workerMaxPendingPerWorker: Math.max(
        1,
        Math.floor(merged.runtime?.workerMaxPendingPerWorker ?? defaults.runtime.workerMaxPendingPerWorker)
      ),
      apiMaxConcurrent: Math.max(1, Math.floor(merged.runtime?.apiMaxConcurrent ?? defaults.runtime.apiMaxConcurrent)),
      apiMaxBodyBytes: Math.max(1024, Math.floor(merged.runtime?.apiMaxBodyBytes ?? defaults.runtime.apiMaxBodyBytes)),
      apiRequestTimeoutMs: Math.max(
        100,
        Math.floor(merged.runtime?.apiRequestTimeoutMs ?? defaults.runtime.apiRequestTimeoutMs)
      ),
      agentMaxConcurrent: Math.max(
        1,
        Math.floor(merged.runtime?.agentMaxConcurrent ?? defaults.runtime.agentMaxConcurrent)
      ),
      agentMaxRequestBytes: Math.max(
        256,
        Math.floor(merged.runtime?.agentMaxRequestBytes ?? defaults.runtime.agentMaxRequestBytes)
      ),
      publishDurableEnabled: merged.runtime?.publishDurableEnabled ?? defaults.runtime.publishDurableEnabled,
      publishDurableTimeoutMs: Math.max(
        100,
        Math.floor(merged.runtime?.publishDurableTimeoutMs ?? defaults.runtime.publishDurableTimeoutMs)
      ),
      callRateLimitPerSec: Math.max(0, Math.floor(merged.runtime?.callRateLimitPerSec ?? defaults.runtime.callRateLimitPerSec)),
      circuitBreakerFailureThreshold: Math.max(
        1,
        Math.floor(merged.runtime?.circuitBreakerFailureThreshold ?? defaults.runtime.circuitBreakerFailureThreshold)
      ),
      circuitBreakerCooldownMs: Math.max(
        1,
        Math.floor(merged.runtime?.circuitBreakerCooldownMs ?? defaults.runtime.circuitBreakerCooldownMs)
      ),
      circuitBreakerHalfOpenMax: Math.max(
        1,
        Math.floor(merged.runtime?.circuitBreakerHalfOpenMax ?? defaults.runtime.circuitBreakerHalfOpenMax)
      ),
      monitorMaxParallel: Math.max(
        1,
        Math.floor(merged.runtime?.monitorMaxParallel ?? defaults.runtime.monitorMaxParallel)
      ),
      monitorJitterMs: Math.max(0, Math.floor(merged.runtime?.monitorJitterMs ?? defaults.runtime.monitorJitterMs)),
      monitorDownBackoffFactor: Math.max(
        1,
        merged.runtime?.monitorDownBackoffFactor ?? defaults.runtime.monitorDownBackoffFactor
      ),
      monitorDownBackoffMaxMs: Math.max(
        100,
        Math.floor(merged.runtime?.monitorDownBackoffMaxMs ?? defaults.runtime.monitorDownBackoffMaxMs)
      )
    },
    agent: {
      enabled: merged.agent?.enabled ?? defaults.agent.enabled,
      socketPath: merged.agent?.socketPath || path.join(dataDir, "agent.sock")
    }
  };

  ensureDir(finalConfig.dataDir);
  ensureDir(finalConfig.traceDir);
  ensureDir(finalConfig.servicesDir);
  if (finalConfig.api.allowedHosts.length === 0) {
    finalConfig.api.allowedHosts = ["127.0.0.1", "localhost", "::1"];
  }
  if (finalConfig.api.tls.requireClientCert) {
    finalConfig.api.tls.requestClientCert = true;
  }
  return finalConfig;
}

export function readUserConfigRaw(): Record<string, unknown> {
  return maybeReadObject(USER_CONFIG_PATH);
}

export function writeUserConfigRaw(input: Record<string, unknown>): void {
  writeJsonFile(USER_CONFIG_PATH, input);
}
