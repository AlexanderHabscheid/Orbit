import { Logger } from "../logger.js";
import { OrbitConfig } from "../types.js";
import { sendFederatedMessage } from "../federation/transport.js";

export async function cmdFederate(
  config: OrbitConfig,
  logger: Logger,
  opts: {
    to: string;
    target: string;
    body: unknown;
    endpoint?: string;
    runId?: string;
    timeoutMs?: number;
    deliveryClass?: "best_effort" | "durable" | "auditable";
    e2eeKeyId?: string;
  }
): Promise<void> {
  const out = await sendFederatedMessage(config, {
    to: opts.to,
    target: opts.target,
    body: opts.body,
    endpoint: opts.endpoint,
    runId: opts.runId,
    timeoutMs: opts.timeoutMs,
    deliveryClass: opts.deliveryClass,
    e2eeKeyId: opts.e2eeKeyId
  });
  logger.info("federated send", out as Record<string, unknown>);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}
