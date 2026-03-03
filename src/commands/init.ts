import { Logger } from "../logger.js";
import { OrbitError } from "../errors.js";
import { StarProfile, runStarInit } from "../star.js";

const ALLOWED_PROFILES: StarProfile[] = ["single-agent", "multi-agent", "production"];

export function cmdInit(
  logger: Logger,
  opts: { cwd: string; outDir: string; profile: string; force: boolean }
): void {
  if (!ALLOWED_PROFILES.includes(opts.profile as StarProfile)) {
    throw new OrbitError("BAD_ARGS", `--profile must be one of: ${ALLOWED_PROFILES.join(", ")}`);
  }
  const summary = runStarInit({
    cwd: opts.cwd,
    baseDir: opts.outDir,
    profile: opts.profile as StarProfile,
    force: opts.force
  });
  logger.info("star init completed", {
    module: summary.module,
    profile: summary.profile,
    created: summary.created.length,
    skipped: summary.skipped.length
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
