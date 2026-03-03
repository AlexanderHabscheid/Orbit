#!/usr/bin/env node
import process from "node:process";
import { run } from "./cli.js";
import { OrbitError } from "./errors.js";

run(process.argv.slice(2), process.cwd()).catch((err) => {
  if (err instanceof OrbitError) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: err.code, message: err.message, details: err.details })}\n`);
    process.exit(2);
  }
  process.stderr.write(`${JSON.stringify({ ok: false, code: "UNHANDLED", message: (err as Error).message })}\n`);
  process.exit(1);
});

