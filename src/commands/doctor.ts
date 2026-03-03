import { Logger } from "../logger.js";
import { OrbitConfig } from "../types.js";
import { runStarDoctor } from "../star.js";

export async function cmdDoctor(config: OrbitConfig, logger: Logger): Promise<void> {
  const report = await runStarDoctor(config);
  logger.info("star doctor completed", {
    module: report.module,
    ok: report.ok,
    checks: report.checks.length
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
}
