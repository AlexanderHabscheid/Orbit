import process from "node:process";
import { performance } from "node:perf_hooks";
import { createEnvelope, validateEnvelope } from "../src/envelope.js";
import { OrbitConfig } from "../src/types.js";
import { afterCallAttempt, beforeCall, onCallSuccess } from "../src/call_protection.js";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function benchmarkEnvelope(iterations: number): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const env = createEnvelope({
      kind: "request",
      runId: `perf-${i}`,
      payload: { n: i, text: "orbit" }
    });
    validateEnvelope(env);
  }
  return performance.now() - start;
}

function minimalConfig(rateLimitPerSec: number): OrbitConfig {
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
    runtime: {
      serveMaxInflightGlobal: 64,
      serveMaxInflightPerMethod: 16,
      serveMaxQueueDepth: 256,
      workerPoolSize: 2,
      workerMaxPendingPerWorker: 64,
      apiMaxConcurrent: 128,
      apiMaxBodyBytes: 1_048_576,
      apiRequestTimeoutMs: 15000,
      agentMaxConcurrent: 128,
      agentMaxRequestBytes: 262_144,
      callRateLimitPerSec: rateLimitPerSec,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerCooldownMs: 10_000,
      circuitBreakerHalfOpenMax: 1,
      monitorMaxParallel: 8,
      monitorJitterMs: 200,
      monitorDownBackoffFactor: 1.6,
      monitorDownBackoffMaxMs: 15_000
    },
    agent: { enabled: true, socketPath: "/tmp/orbit/agent.sock" },
    broker: {
      host: "127.0.0.1",
      port: 4222,
      dockerImage: "nats:2",
      containerName: "orbit-nats"
    }
  };
}

function benchmarkProtection(iterations: number): number {
  const cfg = minimalConfig(iterations * 2);
  const target = "perf.target";
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    beforeCall(cfg, target);
    onCallSuccess(target);
    afterCallAttempt(target);
  }
  return performance.now() - start;
}

const iterations = envNumber("ORBIT_PERF_ENVELOPE_ITERS", 50_000);
const maxMs = envNumber("ORBIT_PERF_ENVELOPE_MAX_MS", 3000);
const elapsed = benchmarkEnvelope(iterations);
const protectionIters = envNumber("ORBIT_PERF_PROTECTION_ITERS", 100_000);
const protectionMaxMs = envNumber("ORBIT_PERF_PROTECTION_MAX_MS", 1500);
const protectionElapsed = benchmarkProtection(protectionIters);

process.stdout.write(
  `${JSON.stringify(
    {
      benchmarks: [
        { benchmark: "envelope_roundtrip", iterations, elapsed_ms: Math.round(elapsed), budget_ms: maxMs },
        {
          benchmark: "call_protection_cycle",
          iterations: protectionIters,
          elapsed_ms: Math.round(protectionElapsed),
          budget_ms: protectionMaxMs
        }
      ]
    },
    null,
    2
  )}\n`
);

if (elapsed > maxMs) {
  process.stderr.write(`perf budget exceeded: ${Math.round(elapsed)}ms > ${maxMs}ms\n`);
  process.exit(1);
}
if (protectionElapsed > protectionMaxMs) {
  process.stderr.write(`perf budget exceeded: ${Math.round(protectionElapsed)}ms > ${protectionMaxMs}ms\n`);
  process.exit(1);
}
