import { Logger } from "../logger.js";
import { closeBus, connectBus } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { executeOrbitAction } from "../orbit_actions.js";

export async function cmdBridge(
  config: OrbitConfig,
  logger: Logger,
  opts: {
    protocol: "a2a" | "mcp";
    message: Record<string, unknown>;
    dispatch: boolean;
    to?: string;
    target?: string;
  }
): Promise<void> {
  const nc = await connectBus(config.natsUrl);
  try {
    const out = await executeOrbitAction(
      config,
      nc,
      "bridge",
      {
        protocol: opts.protocol,
        message: opts.message,
        dispatch: opts.dispatch,
        to: opts.to,
        target: opts.target
      },
      "api"
    );
    logger.info("bridge processed", out as Record<string, unknown>);
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } finally {
    await closeBus(config.natsUrl).catch(() => undefined);
  }
}
