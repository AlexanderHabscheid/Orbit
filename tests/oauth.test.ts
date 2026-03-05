import test from "node:test";
import assert from "node:assert/strict";
import { issueClientCredentialsToken, verifyBearerToken } from "../src/identity/oauth.js";
import { OrbitConfig } from "../src/types.js";

function config(): OrbitConfig {
  return {
    natsUrl: "nats://127.0.0.1:4222",
    requestTimeoutMs: 1000,
    retries: 1,
    logLevel: "info",
    dataDir: "/tmp",
    traceDir: "/tmp",
    servicesDir: "/tmp",
    activeContext: "default",
    kvBucket: "kv",
    objectStoreBucket: "obj",
    otel: { serviceName: "test" },
    performance: {
      mode: "balanced",
      traceSampleRate: 1,
      trustedLocal: false,
      traceBufferMaxEvents: 1000,
      traceFlushIntervalMs: 25
    },
    routing: { subjectPrefix: "orbit" },
    api: {
      allowedHosts: ["127.0.0.1"],
      tls: {
        enabled: false,
        requestClientCert: false,
        requireClientCert: false
      }
    },
    federation: {
      enabled: true,
      localDomain: "local.test",
      defaultDeliveryClass: "best_effort",
      discoverWellKnown: true,
      discoveryTimeoutMs: 1000,
      requestTimeoutMs: 1000,
      replayWindowSec: 300,
      allowlist: [],
      blocklist: [],
      signing: {
        algorithm: "hmac-sha256",
        discoverJwks: true,
        requireSignedInbound: false,
        trustedKeys: {}
      },
      oauth: {
        enabled: true,
        issuer: "http://127.0.0.1:8787",
        audience: "orbit-federation",
        tokenTtlSec: 3600,
        clients: {
          "agent-1": "secret-1"
        }
      },
      reputation: {
        enabled: true,
        defaultScore: 50,
        minScore: 20,
        trustOnFirstSeen: false
      },
      challenge: {
        enabled: true,
        difficulty: 3,
        ttlSec: 120,
        graceSec: 900
      },
      e2ee: {
        enabled: false,
        keys: {}
      }
    },
    runtime: {
      serveMaxInflightGlobal: 1,
      serveMaxInflightPerMethod: 1,
      serveMaxQueueDepth: 1,
      workerPoolSize: 1,
      workerMaxPendingPerWorker: 1,
      apiMaxConcurrent: 1,
      apiMaxBodyBytes: 1024,
      apiRequestTimeoutMs: 1000,
      agentMaxConcurrent: 1,
      agentMaxRequestBytes: 1024,
      publishDurableEnabled: false,
      publishDurableTimeoutMs: 1000,
      callRateLimitPerSec: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerCooldownMs: 1000,
      circuitBreakerHalfOpenMax: 1,
      monitorMaxParallel: 1,
      monitorJitterMs: 0,
      monitorDownBackoffFactor: 1,
      monitorDownBackoffMaxMs: 1000
    },
    agent: {
      enabled: true,
      socketPath: "/tmp/a.sock"
    },
    broker: {
      host: "127.0.0.1",
      port: 4222,
      dockerImage: "nats:2",
      containerName: "orbit-nats"
    }
  };
}

test("oauth issue + verify client_credentials token", () => {
  const cfg = config();
  const issued = issueClientCredentialsToken(cfg, { clientId: "agent-1", clientSecret: "secret-1" });
  assert.equal(issued.token_type, "Bearer");
  const verified = verifyBearerToken(cfg, String(issued.access_token));
  assert.equal(verified.clientId, "agent-1");
});
