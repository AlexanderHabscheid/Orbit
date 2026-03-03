import { OrbitError } from "../errors.js";
import { Logger } from "../logger.js";
import { closeBus, connectBus } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { canUseAgent, requestAgent } from "../agent_ipc.js";
import { executeRpcCall } from "../rpc_call.js";

export async function cmdCall(
  config: OrbitConfig,
  logger: Logger,
  opts: {
    target: string;
    body: unknown;
    timeoutMs?: number;
    retries?: number;
    runId?: string;
    packFile?: string;
  }
): Promise<void> {
  const m = opts.target.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
  if (!m) throw new OrbitError("BAD_TARGET", "target must be <service>.<method>");
  if (canUseAgent(config)) {
    try {
      const payload = await requestAgent(
        config,
        "call",
        {
          target: opts.target,
          body: opts.body,
          timeoutMs: opts.timeoutMs ?? config.requestTimeoutMs,
          retries: opts.retries ?? config.retries,
          runId: opts.runId,
          packFile: opts.packFile
        },
        opts.timeoutMs ?? config.requestTimeoutMs
      );
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    } catch (err) {
      logger.warn("agent call failed, falling back to direct NATS path", { err: String(err) });
    }
  }
  const nc = await connectBus(config.natsUrl);
  const payload = (await executeRpcCall(config, nc, {
    target: opts.target,
    body: opts.body,
    timeoutMs: opts.timeoutMs,
    retries: opts.retries,
    runId: opts.runId,
    packFile: opts.packFile,
    actor: "cli"
  })) as { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } };
  if (payload?.ok === false) {
    logger.error("service returned error", { code: payload.error?.code, message: payload.error?.message });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
  await closeBus(config.natsUrl);
}
