import { createEnvelope, validateEnvelope } from "../envelope.js";
import { OrbitError } from "../errors.js";
import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson, encodeJson } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { canUseAgent, requestAgent } from "../agent_ipc.js";
import { prefixedSubject } from "../subjects.js";
import { randomId } from "../util.js";

function percentile(input: number[], p: number): number {
  if (input.length === 0) return 0;
  const sorted = [...input].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export async function cmdBenchOverhead(
  config: OrbitConfig,
  _logger: Logger,
  opts: { target: string; body: unknown; iterations: number; timeoutMs?: number }
): Promise<void> {
  const m = opts.target.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
  if (!m) throw new OrbitError("BAD_TARGET", "target must be <service>.<method>");
  if (!canUseAgent(config)) {
    throw new OrbitError("AGENT_DISABLED", "bench-overhead requires local agent enabled");
  }
  const [, svc, method] = m;
  const iterations = Math.max(1, Math.floor(opts.iterations));
  const timeoutMs = opts.timeoutMs ?? config.requestTimeoutMs;
  const subject = prefixedSubject(config, "rpc", svc, method);

  const direct: number[] = [];
  const viaAgent: number[] = [];

  const nc = await connectBus(config.natsUrl);
  try {
    for (let i = 0; i < iterations; i += 1) {
      const runId = randomId();
      const reqEnv = createEnvelope({
        kind: "request",
        runId,
        payload: opts.body,
        provenance: { caller: "orbit-bench-overhead", target: opts.target }
      });
      const directStart = Date.now();
      const directMsg = await nc.request(subject, encodeJson(reqEnv), { timeout: timeoutMs });
      validateEnvelope(decodeJson(directMsg.data), { skipHashCheck: config.performance.trustedLocal });
      direct.push(Date.now() - directStart);

      const agentStart = Date.now();
      await requestAgent(
        config,
        "call",
        { target: opts.target, body: opts.body, timeoutMs, runId: randomId() },
        timeoutMs
      );
      viaAgent.push(Date.now() - agentStart);
    }
  } finally {
    await closeBus(config.natsUrl);
  }

  const p95Direct = percentile(direct, 95);
  const p95Agent = percentile(viaAgent, 95);
  const result = {
    ok: true,
    target: opts.target,
    iterations,
    latency_ms: {
      direct: {
        p50: percentile(direct, 50),
        p95: p95Direct
      },
      via_agent: {
        p50: percentile(viaAgent, 50),
        p95: p95Agent
      }
    },
    orbit_overhead_ms: {
      p50: Math.max(0, percentile(viaAgent, 50) - percentile(direct, 50)),
      p95: Math.max(0, p95Agent - p95Direct)
    }
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
