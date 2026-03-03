import test from "node:test";
import assert from "node:assert/strict";
import { OrbitConfig } from "../src/types.js";
import { afterCallAttempt, beforeCall, onCallFailure, onCallSuccess } from "../src/call_protection.js";

function config(overrides?: Partial<OrbitConfig["runtime"]>): OrbitConfig {
  return {
    natsUrl: "nats://127.0.0.1:4222",
    requestTimeoutMs: 1000,
    retries: 0,
    logLevel: "info",
    dataDir: "/tmp/orbit",
    traceDir: "/tmp/orbit/traces",
    servicesDir: "/tmp/orbit/services",
    activeContext: "default",
    kvBucket: "orbit_registry",
    objectStoreBucket: "orbit_datapacks",
    otel: { serviceName: "orbit-cli" },
    performance: {
      mode: "balanced",
      traceSampleRate: 0,
      trustedLocal: false,
      traceBufferMaxEvents: 1000,
      traceFlushIntervalMs: 25
    },
    routing: { subjectPrefix: "orbit" },
    api: {
      allowedHosts: ["127.0.0.1", "localhost"],
      tls: {
        enabled: false,
        requestClientCert: false,
        requireClientCert: false
      }
    },
    runtime: {
      serveMaxInflightGlobal: 64,
      serveMaxInflightPerMethod: 16,
      serveMaxQueueDepth: 256,
      workerPoolSize: 2,
      workerMaxPendingPerWorker: 64,
      apiMaxConcurrent: 128,
      apiMaxBodyBytes: 1024 * 1024,
      apiRequestTimeoutMs: 15000,
      agentMaxConcurrent: 128,
      agentMaxRequestBytes: 256 * 1024,
      publishDurableEnabled: false,
      publishDurableTimeoutMs: 2500,
      callRateLimitPerSec: 0,
      circuitBreakerFailureThreshold: 3,
      circuitBreakerCooldownMs: 1000,
      circuitBreakerHalfOpenMax: 1,
      monitorMaxParallel: 4,
      monitorJitterMs: 10,
      monitorDownBackoffFactor: 1.6,
      monitorDownBackoffMaxMs: 15000,
      ...overrides
    } as OrbitConfig["runtime"],
    agent: { enabled: true, socketPath: "/tmp/orbit/agent.sock" },
    broker: {
      host: "127.0.0.1",
      port: 4222,
      dockerImage: "nats:2",
      containerName: "orbit-nats"
    }
  };
}

test("beforeCall enforces rate limiting", () => {
  const cfg = config({ callRateLimitPerSec: 1 });
  beforeCall(cfg, "svc.m");
  assert.throws(() => beforeCall(cfg, "svc.m"), /rate limited/);
  afterCallAttempt("svc.m");
});

test("circuit opens after threshold failures", () => {
  const cfg = config({ circuitBreakerFailureThreshold: 2, circuitBreakerCooldownMs: 100000 });
  onCallFailure(cfg, "svc.open");
  onCallFailure(cfg, "svc.open");
  assert.throws(() => beforeCall(cfg, "svc.open"), /circuit open/);
});

test("half-open allows recovery after cooldown", async () => {
  const cfg = config({ circuitBreakerFailureThreshold: 1, circuitBreakerCooldownMs: 5, circuitBreakerHalfOpenMax: 1 });
  onCallFailure(cfg, "svc.recover");
  await new Promise((resolve) => setTimeout(resolve, 10));
  beforeCall(cfg, "svc.recover");
  onCallSuccess("svc.recover");
  afterCallAttempt("svc.recover");
  assert.doesNotThrow(() => beforeCall(cfg, "svc.recover"));
  afterCallAttempt("svc.recover");
});
