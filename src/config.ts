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
  if (obj.federation && typeof obj.federation === "object") {
    const fedRaw = obj.federation as Record<string, unknown>;
    const reputationRaw =
      fedRaw.reputation && typeof fedRaw.reputation === "object" ? (fedRaw.reputation as Record<string, unknown>) : {};
    const challengeRaw =
      fedRaw.challenge && typeof fedRaw.challenge === "object" ? (fedRaw.challenge as Record<string, unknown>) : {};
    const e2eeRaw = fedRaw.e2ee && typeof fedRaw.e2ee === "object" ? (fedRaw.e2ee as Record<string, unknown>) : {};
    const e2eeKeysRaw =
      e2eeRaw.keys && typeof e2eeRaw.keys === "object" ? (e2eeRaw.keys as Record<string, unknown>) : {};
    const signingRaw =
      fedRaw.signing && typeof fedRaw.signing === "object" ? (fedRaw.signing as Record<string, unknown>) : {};
    const trustedKeysRaw =
      signingRaw.trustedKeys && typeof signingRaw.trustedKeys === "object"
        ? (signingRaw.trustedKeys as Record<string, unknown>)
        : {};
    out.federation = {
      enabled: typeof fedRaw.enabled === "boolean" ? fedRaw.enabled : false,
      localDomain: typeof fedRaw.localDomain === "string" ? fedRaw.localDomain : "localhost",
      defaultDeliveryClass:
        fedRaw.defaultDeliveryClass === "durable" || fedRaw.defaultDeliveryClass === "auditable"
          ? fedRaw.defaultDeliveryClass
          : "best_effort",
      discoverWellKnown: typeof fedRaw.discoverWellKnown === "boolean" ? fedRaw.discoverWellKnown : true,
      discoveryTimeoutMs: typeof fedRaw.discoveryTimeoutMs === "number" ? fedRaw.discoveryTimeoutMs : 3000,
      requestTimeoutMs: typeof fedRaw.requestTimeoutMs === "number" ? fedRaw.requestTimeoutMs : 5000,
      replayWindowSec: typeof fedRaw.replayWindowSec === "number" ? fedRaw.replayWindowSec : 300,
      inboundAuthToken: typeof fedRaw.inboundAuthToken === "string" ? fedRaw.inboundAuthToken : undefined,
      allowlist: Array.isArray(fedRaw.allowlist) ? fedRaw.allowlist.filter((v): v is string => typeof v === "string") : [],
      blocklist: Array.isArray(fedRaw.blocklist) ? fedRaw.blocklist.filter((v): v is string => typeof v === "string") : [],
      signing: {
        keyId: typeof signingRaw.keyId === "string" ? signingRaw.keyId : undefined,
        secret: typeof signingRaw.secret === "string" ? signingRaw.secret : undefined,
        algorithm: signingRaw.algorithm === "ed25519" ? "ed25519" : "hmac-sha256",
        privateKeyFile: typeof signingRaw.privateKeyFile === "string" ? signingRaw.privateKeyFile : undefined,
        publicKeyFile: typeof signingRaw.publicKeyFile === "string" ? signingRaw.publicKeyFile : undefined,
        discoverJwks: typeof signingRaw.discoverJwks === "boolean" ? signingRaw.discoverJwks : true,
        requireSignedInbound: typeof signingRaw.requireSignedInbound === "boolean" ? signingRaw.requireSignedInbound : false,
        trustedKeys: Object.fromEntries(
          Object.entries(trustedKeysRaw).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        )
      },
      oauth: {
        enabled: typeof fedRaw.oauth === "object" && fedRaw.oauth !== null
          ? Boolean((fedRaw.oauth as Record<string, unknown>).enabled)
          : false,
        issuer:
          typeof fedRaw.oauth === "object" && fedRaw.oauth !== null && typeof (fedRaw.oauth as Record<string, unknown>).issuer === "string"
            ? ((fedRaw.oauth as Record<string, unknown>).issuer as string)
            : "http://127.0.0.1:8787",
        audience:
          typeof fedRaw.oauth === "object" && fedRaw.oauth !== null && typeof (fedRaw.oauth as Record<string, unknown>).audience === "string"
            ? ((fedRaw.oauth as Record<string, unknown>).audience as string)
            : "orbit-federation",
        tokenTtlSec:
          typeof fedRaw.oauth === "object" && fedRaw.oauth !== null && typeof (fedRaw.oauth as Record<string, unknown>).tokenTtlSec === "number"
            ? ((fedRaw.oauth as Record<string, unknown>).tokenTtlSec as number)
            : 3600,
        clients:
          typeof fedRaw.oauth === "object" &&
          fedRaw.oauth !== null &&
          typeof (fedRaw.oauth as Record<string, unknown>).clients === "object" &&
          (fedRaw.oauth as Record<string, unknown>).clients !== null
            ? Object.fromEntries(
                Object.entries((fedRaw.oauth as Record<string, unknown>).clients as Record<string, unknown>).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string"
                )
              )
            : {}
      },
      reputation: {
        enabled: typeof reputationRaw.enabled === "boolean" ? reputationRaw.enabled : true,
        defaultScore: typeof reputationRaw.defaultScore === "number" ? reputationRaw.defaultScore : 50,
        minScore: typeof reputationRaw.minScore === "number" ? reputationRaw.minScore : 20,
        trustOnFirstSeen: typeof reputationRaw.trustOnFirstSeen === "boolean" ? reputationRaw.trustOnFirstSeen : false
      },
      challenge: {
        enabled: typeof challengeRaw.enabled === "boolean" ? challengeRaw.enabled : true,
        difficulty: typeof challengeRaw.difficulty === "number" ? challengeRaw.difficulty : 3,
        ttlSec: typeof challengeRaw.ttlSec === "number" ? challengeRaw.ttlSec : 120,
        graceSec: typeof challengeRaw.graceSec === "number" ? challengeRaw.graceSec : 900
      },
      e2ee: {
        enabled: typeof e2eeRaw.enabled === "boolean" ? e2eeRaw.enabled : false,
        keys: Object.fromEntries(
          Object.entries(e2eeKeysRaw).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        )
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
  let trustedFederationKeysEnv: Record<string, string> = {};
  const trustedKeysJson = process.env.ORBIT_FEDERATION_TRUSTED_KEYS_JSON;
  if (trustedKeysJson) {
    try {
      const parsed = JSON.parse(trustedKeysJson) as Record<string, unknown>;
      trustedFederationKeysEnv = Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      );
    } catch {
      trustedFederationKeysEnv = {};
    }
  }
  let e2eeKeysEnv: Record<string, string> = {};
  const e2eeKeysJson = process.env.ORBIT_FEDERATION_E2EE_KEYS_JSON;
  if (e2eeKeysJson) {
    try {
      const parsed = JSON.parse(e2eeKeysJson) as Record<string, unknown>;
      e2eeKeysEnv = Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
      );
    } catch {
      e2eeKeysEnv = {};
    }
  }

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
    federation: {
      enabled: process.env.ORBIT_FEDERATION_ENABLED === "1",
      localDomain: process.env.ORBIT_FEDERATION_LOCAL_DOMAIN ?? "localhost",
      defaultDeliveryClass:
        process.env.ORBIT_FEDERATION_DEFAULT_DELIVERY_CLASS === "durable" ||
        process.env.ORBIT_FEDERATION_DEFAULT_DELIVERY_CLASS === "auditable"
          ? process.env.ORBIT_FEDERATION_DEFAULT_DELIVERY_CLASS
          : "best_effort",
      discoverWellKnown: process.env.ORBIT_FEDERATION_DISCOVER_WELL_KNOWN
        ? process.env.ORBIT_FEDERATION_DISCOVER_WELL_KNOWN === "1"
        : true,
      discoveryTimeoutMs: Number(process.env.ORBIT_FEDERATION_DISCOVERY_TIMEOUT_MS ?? "3000"),
      requestTimeoutMs: Number(process.env.ORBIT_FEDERATION_REQUEST_TIMEOUT_MS ?? "5000"),
      replayWindowSec: Number(process.env.ORBIT_FEDERATION_REPLAY_WINDOW_SEC ?? "300"),
      inboundAuthToken: process.env.ORBIT_FEDERATION_INBOUND_TOKEN,
      allowlist: (process.env.ORBIT_FEDERATION_ALLOWLIST ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      blocklist: (process.env.ORBIT_FEDERATION_BLOCKLIST ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      signing: {
        keyId: process.env.ORBIT_FEDERATION_KEY_ID,
        secret: process.env.ORBIT_FEDERATION_SIGNING_SECRET,
        algorithm: process.env.ORBIT_FEDERATION_SIGNING_ALGORITHM === "ed25519" ? "ed25519" : "hmac-sha256",
        privateKeyFile: process.env.ORBIT_FEDERATION_PRIVATE_KEY_FILE,
        publicKeyFile: process.env.ORBIT_FEDERATION_PUBLIC_KEY_FILE,
        discoverJwks: process.env.ORBIT_FEDERATION_DISCOVER_JWKS
          ? process.env.ORBIT_FEDERATION_DISCOVER_JWKS === "1"
          : true,
        requireSignedInbound: process.env.ORBIT_FEDERATION_REQUIRE_SIGNED_INBOUND === "1",
        trustedKeys: trustedFederationKeysEnv
      },
      oauth: {
        enabled: process.env.ORBIT_FEDERATION_OAUTH_ENABLED === "1",
        issuer: process.env.ORBIT_FEDERATION_OAUTH_ISSUER ?? "http://127.0.0.1:8787",
        audience: process.env.ORBIT_FEDERATION_OAUTH_AUDIENCE ?? "orbit-federation",
        tokenTtlSec: Number(process.env.ORBIT_FEDERATION_OAUTH_TOKEN_TTL_SEC ?? "3600"),
        clients: {}
      },
      reputation: {
        enabled: process.env.ORBIT_FEDERATION_REPUTATION_ENABLED
          ? process.env.ORBIT_FEDERATION_REPUTATION_ENABLED === "1"
          : true,
        defaultScore: Number(process.env.ORBIT_FEDERATION_REPUTATION_DEFAULT_SCORE ?? "50"),
        minScore: Number(process.env.ORBIT_FEDERATION_REPUTATION_MIN_SCORE ?? "20"),
        trustOnFirstSeen: process.env.ORBIT_FEDERATION_REPUTATION_TRUST_FIRST_SEEN === "1"
      },
      challenge: {
        enabled: process.env.ORBIT_FEDERATION_CHALLENGE_ENABLED
          ? process.env.ORBIT_FEDERATION_CHALLENGE_ENABLED === "1"
          : true,
        difficulty: Number(process.env.ORBIT_FEDERATION_CHALLENGE_DIFFICULTY ?? "3"),
        ttlSec: Number(process.env.ORBIT_FEDERATION_CHALLENGE_TTL_SEC ?? "120"),
        graceSec: Number(process.env.ORBIT_FEDERATION_CHALLENGE_GRACE_SEC ?? "900")
      },
      e2ee: {
        enabled: process.env.ORBIT_FEDERATION_E2EE_ENABLED === "1",
        keys: e2eeKeysEnv
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
    federation: {
      enabled: merged.federation?.enabled ?? defaults.federation.enabled,
      localDomain: (merged.federation?.localDomain ?? defaults.federation.localDomain).trim() || "localhost",
      defaultDeliveryClass: merged.federation?.defaultDeliveryClass ?? defaults.federation.defaultDeliveryClass,
      discoverWellKnown: merged.federation?.discoverWellKnown ?? defaults.federation.discoverWellKnown,
      discoveryTimeoutMs: Math.max(
        250,
        Math.floor(merged.federation?.discoveryTimeoutMs ?? defaults.federation.discoveryTimeoutMs)
      ),
      requestTimeoutMs: Math.max(
        250,
        Math.floor(merged.federation?.requestTimeoutMs ?? defaults.federation.requestTimeoutMs)
      ),
      replayWindowSec: Math.max(30, Math.floor(merged.federation?.replayWindowSec ?? defaults.federation.replayWindowSec)),
      inboundAuthToken: merged.federation?.inboundAuthToken ?? defaults.federation.inboundAuthToken,
      allowlist: (merged.federation?.allowlist ?? defaults.federation.allowlist).map((v) => v.trim()).filter(Boolean),
      blocklist: (merged.federation?.blocklist ?? defaults.federation.blocklist).map((v) => v.trim()).filter(Boolean),
      signing: {
        keyId: merged.federation?.signing?.keyId ?? defaults.federation.signing.keyId,
        secret: merged.federation?.signing?.secret ?? defaults.federation.signing.secret,
        algorithm: merged.federation?.signing?.algorithm ?? defaults.federation.signing.algorithm,
        privateKeyFile: (merged.federation?.signing?.privateKeyFile ?? defaults.federation.signing.privateKeyFile)
          ? expandHome(merged.federation?.signing?.privateKeyFile ?? defaults.federation.signing.privateKeyFile ?? "")
          : undefined,
        publicKeyFile: (merged.federation?.signing?.publicKeyFile ?? defaults.federation.signing.publicKeyFile)
          ? expandHome(merged.federation?.signing?.publicKeyFile ?? defaults.federation.signing.publicKeyFile ?? "")
          : undefined,
        discoverJwks: merged.federation?.signing?.discoverJwks ?? defaults.federation.signing.discoverJwks,
        requireSignedInbound:
          merged.federation?.signing?.requireSignedInbound ?? defaults.federation.signing.requireSignedInbound,
        trustedKeys: {
          ...defaults.federation.signing.trustedKeys,
          ...(merged.federation?.signing?.trustedKeys ?? {})
        }
      },
      oauth: {
        enabled: merged.federation?.oauth?.enabled ?? defaults.federation.oauth.enabled,
        issuer: (merged.federation?.oauth?.issuer ?? defaults.federation.oauth.issuer).trim() || "http://127.0.0.1:8787",
        audience: (merged.federation?.oauth?.audience ?? defaults.federation.oauth.audience).trim() || "orbit-federation",
        tokenTtlSec: Math.max(60, Math.floor(merged.federation?.oauth?.tokenTtlSec ?? defaults.federation.oauth.tokenTtlSec)),
        clients: {
          ...defaults.federation.oauth.clients,
          ...(merged.federation?.oauth?.clients ?? {})
        }
      },
      reputation: {
        enabled: merged.federation?.reputation?.enabled ?? defaults.federation.reputation.enabled,
        defaultScore: Math.max(0, Math.floor(merged.federation?.reputation?.defaultScore ?? defaults.federation.reputation.defaultScore)),
        minScore: Math.max(0, Math.floor(merged.federation?.reputation?.minScore ?? defaults.federation.reputation.minScore)),
        trustOnFirstSeen: merged.federation?.reputation?.trustOnFirstSeen ?? defaults.federation.reputation.trustOnFirstSeen
      },
      challenge: {
        enabled: merged.federation?.challenge?.enabled ?? defaults.federation.challenge.enabled,
        difficulty: Math.max(1, Math.floor(merged.federation?.challenge?.difficulty ?? defaults.federation.challenge.difficulty)),
        ttlSec: Math.max(30, Math.floor(merged.federation?.challenge?.ttlSec ?? defaults.federation.challenge.ttlSec)),
        graceSec: Math.max(60, Math.floor(merged.federation?.challenge?.graceSec ?? defaults.federation.challenge.graceSec))
      },
      e2ee: {
        enabled: merged.federation?.e2ee?.enabled ?? defaults.federation.e2ee.enabled,
        keys: {
          ...defaults.federation.e2ee.keys,
          ...(merged.federation?.e2ee?.keys ?? {})
        }
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
