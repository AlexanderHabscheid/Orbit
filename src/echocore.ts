#!/usr/bin/env node
import { runEchoCli } from "./echo/cli.js";

runEchoCli(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, message: (err as Error).message })}\n`);
  process.exit(1);
});
