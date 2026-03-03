import { createEnvelope, validateEnvelope } from "../envelope.js";
import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson, encodeJson } from "../nats.js";
import { loadServiceRecordDistributed } from "../registry.js";
import { OrbitConfig } from "../types.js";
import { canUseAgent, requestAgent } from "../agent_ipc.js";
import { prefixedSubject } from "../subjects.js";

export async function cmdInspect(
  config: OrbitConfig,
  logger: Logger,
  opts: { service: string; timeoutMs?: number }
): Promise<void> {
  if (canUseAgent(config)) {
    try {
      const payload = await requestAgent(
        config,
        "inspect",
        { service: opts.service, timeoutMs: opts.timeoutMs ?? config.requestTimeoutMs },
        opts.timeoutMs ?? config.requestTimeoutMs
      );
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    } catch (err) {
      logger.warn("agent inspect failed, falling back to direct NATS path", { service: opts.service, err: String(err) });
    }
  }
  try {
    const nc = await connectBus(config.natsUrl);
    try {
      const msg = await nc.request(
        prefixedSubject(config, "inspect", opts.service),
        encodeJson(createEnvelope({ kind: "request", payload: {} })),
        { timeout: opts.timeoutMs ?? config.requestTimeoutMs }
      );
      const env = validateEnvelope(decodeJson(msg.data), { skipHashCheck: config.performance.trustedLocal });
      process.stdout.write(`${JSON.stringify(env.payload, null, 2)}\n`);
      return;
    } catch {
      try {
        const msg = await nc.request(`$SRV.INFO.${opts.service}`, encodeJson({}), {
          timeout: opts.timeoutMs ?? config.requestTimeoutMs
        });
        const payload = decodeJson(msg.data);
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      } catch {
        const msg = await nc.request(prefixedSubject(config, "discovery", "query"), encodeJson({ service: opts.service }), {
          timeout: opts.timeoutMs ?? config.requestTimeoutMs
        });
        const env = validateEnvelope(decodeJson(msg.data), { skipHashCheck: config.performance.trustedLocal });
        process.stdout.write(`${JSON.stringify(env.payload, null, 2)}\n`);
        return;
      }
    } finally {
      await closeBus(config.natsUrl);
    }
  } catch (err) {
    logger.warn("inspect live request failed, falling back to local registry", { service: opts.service, err: String(err) });
  }

  const local = await loadServiceRecordDistributed(config, opts.service);
  if (!local) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: `service ${opts.service} not found` }, null, 2)}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(local, null, 2)}\n`);
}
