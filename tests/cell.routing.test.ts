import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCellRoutingPlan } from "../src/cell/routing.js";
import { OrbitConfig } from "../src/types.js";

function makeConfig(): OrbitConfig {
  return {
    natsUrl: "nats://127.0.0.1:4222",
    requestTimeoutMs: 5000,
    retries: 1,
    logLevel: "info",
    dataDir: "/tmp/orbit-test",
    traceDir: "/tmp/orbit-test/traces",
    servicesDir: "/tmp/orbit-test/services",
    activeContext: "default",
    kvBucket: "orbit_registry",
    objectStoreBucket: "orbit_datapacks",
    otel: { serviceName: "orbit" },
    performance: {
      mode: "balanced",
      traceSampleRate: 0.2,
      trustedLocal: false,
      traceBufferMaxEvents: 5000,
      traceFlushIntervalMs: 25
    },
    routing: { subjectPrefix: "orbit" },
    runtime: {
      serveMaxInflightGlobal: 64,
      serveMaxInflightPerMethod: 16,
      serveMaxQueueDepth: 256,
      workerPoolSize: 2,
      workerMaxPendingPerWorker: 64,
      apiMaxConcurrent: 128,
      apiMaxBodyBytes: 1024,
      apiRequestTimeoutMs: 1000,
      agentMaxConcurrent: 128,
      agentMaxRequestBytes: 1024,
      publishDurableEnabled: false,
      publishDurableTimeoutMs: 2500,
      callRateLimitPerSec: 0,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerCooldownMs: 1000,
      circuitBreakerHalfOpenMax: 1,
      monitorMaxParallel: 8,
      monitorJitterMs: 100,
      monitorDownBackoffFactor: 1.6,
      monitorDownBackoffMaxMs: 15000
    },
    api: {
      allowedHosts: ["127.0.0.1"],
      tls: { enabled: false, requestClientCert: false, requireClientCert: false }
    },
    federation: {
      enabled: false,
      localDomain: "localhost",
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
        enabled: false,
        issuer: "http://127.0.0.1:8787",
        audience: "orbit-federation",
        tokenTtlSec: 3600,
        clients: {}
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
    agent: { enabled: true, socketPath: "/tmp/orbit-test/agent.sock" },
    broker: { host: "127.0.0.1", port: 4222, dockerImage: "nats:2", containerName: "orbit-nats" }
  };
}

test("resolveCellRoutingPlan from channels", () => {
  const plan = resolveCellRoutingPlan(makeConfig(), { channels: ["agent.loop"], defaultMode: "replicate" });
  assert.equal(plan.routes.length, 1);
  assert.equal(plan.routes[0].channel, "agent.loop");
  assert.equal(plan.routes[0].subject, "orbit.cell.channels.agent.loop");
  assert.equal(plan.routes[0].localToNetwork, true);
  assert.equal(plan.routes[0].networkToLocal, true);
});

test("resolveCellRoutingPlan from file", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-cell-route-"));
  const file = path.join(tmp, "routes.json");
  fs.writeFileSync(file, JSON.stringify({ "agent.audit": { mode: "global_only", subject: "orbit.custom.audit" } }), "utf-8");

  const plan = resolveCellRoutingPlan(makeConfig(), { routesFile: file });
  assert.equal(plan.routes.length, 1);
  assert.equal(plan.routes[0].mode, "global_only");
  assert.equal(plan.routes[0].subject, "orbit.custom.audit");
  assert.equal(plan.routes[0].localToNetwork, true);
  assert.equal(plan.routes[0].networkToLocal, false);
});
