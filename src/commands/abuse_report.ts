import { Logger } from "../logger.js";
import { closeBus, connectBus } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { executeOrbitAction } from "../orbit_actions.js";

export async function cmdAbuseReport(
  config: OrbitConfig,
  logger: Logger,
  opts: {
    reporter: string;
    subject: string;
    reason: string;
    severity?: "low" | "medium" | "high" | "critical";
    evidence?: Record<string, unknown>;
  }
): Promise<void> {
  const nc = await connectBus(config.natsUrl);
  try {
    const out = await executeOrbitAction(
      config,
      nc,
      "abuse_report",
      {
        reporter: opts.reporter,
        subject: opts.subject,
        reason: opts.reason,
        severity: opts.severity,
        evidence: opts.evidence
      },
      "api"
    );
    logger.info("abuse report filed", out as Record<string, unknown>);
    process.stdout.write(`${JSON.stringify(out)}\n`);
  } finally {
    await closeBus(config.natsUrl).catch(() => undefined);
  }
}
