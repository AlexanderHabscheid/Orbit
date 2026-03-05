#!/usr/bin/env node
import fs from "node:fs";
import { OrbitClient } from "./client.js";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function parseJsonInput(arg: string): unknown {
  if (arg.startsWith("@")) {
    return JSON.parse(fs.readFileSync(arg.slice(1), "utf-8")) as unknown;
  }
  return JSON.parse(arg);
}

function usage(): string {
  return `orbit-ts

Usage:
  orbit-ts ping [--base-url http://127.0.0.1:8787] [--token <api-token>]
  orbit-ts call <svc>.<method> --json @req.json [--base-url ...] [--token <api-token>] [--timeout-ms 5000] [--retries 2] [--run-id <id>] [--pack-file ./blob.bin] [--task-id <id>] [--thread-id <id>] [--parent-message-id <id>] [--capabilities '["search"]'] [--traceparent <id>] [--dedupe-key <id>]
  orbit-ts publish <topic> --json @event.json [--base-url ...] [--token <api-token>] [--run-id <id>] [--pack-file ./blob.bin] [--durable] [--dedupe-key <id>] [--task-id <id>] [--thread-id <id>] [--parent-message-id <id>] [--capabilities '["search"]'] [--traceparent <id>]
  orbit-ts inspect <service> [--base-url ...] [--token <api-token>] [--timeout-ms 5000]
  orbit-ts federate <agent@domain> <svc>.<method> --json @req.json [--base-url ...] [--token <api-token>] [--delivery-class best_effort|durable|auditable] [--e2ee-key-id <id>]
  orbit-ts bridge <a2a|mcp> --json @msg.json [--base-url ...] [--token <api-token>] [--dispatch] [--to <agent@domain>] [--target <svc>.<method>]
  orbit-ts abuse-report --reporter <agent@domain> --subject <agent@domain> --reason <text> [--severity low|medium|high|critical] [--evidence @json]
`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  const baseUrl = argValue(args, "--base-url") ?? "http://127.0.0.1:8787";
  const timeoutMs = Number(argValue(args, "--timeout-ms") ?? "5000");
  const token = argValue(args, "--token");
  const client = new OrbitClient({
    baseUrl,
    timeoutMs,
    headers: token ? { authorization: `Bearer ${token}` } : undefined
  });
  const [command, ...rest] = args;
  switch (command) {
    case "ping": {
      process.stdout.write(`${JSON.stringify(await client.ping(), null, 2)}\n`);
      return;
    }
    case "call": {
      const target = rest[0];
      const jsonArg = argValue(rest, "--json");
      if (!target || !jsonArg) throw new Error("call requires target and --json");
      const callTimeoutMs = argValue(rest, "--timeout-ms") ? Number(argValue(rest, "--timeout-ms")) : timeoutMs;
      const retriesArg = argValue(rest, "--retries");
      const out = await client.call({
        target,
        body: parseJsonInput(jsonArg),
        timeoutMs: callTimeoutMs,
        retries: retriesArg ? Number(retriesArg) : undefined,
        runId: argValue(rest, "--run-id"),
        packFile: argValue(rest, "--pack-file"),
        taskId: argValue(rest, "--task-id"),
        threadId: argValue(rest, "--thread-id"),
        parentMessageId: argValue(rest, "--parent-message-id"),
        capabilities: argValue(rest, "--capabilities")
          ? (parseJsonInput(argValue(rest, "--capabilities") as string) as string[])
          : undefined,
        traceparent: argValue(rest, "--traceparent"),
        dedupeKey: argValue(rest, "--dedupe-key")
      });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    case "publish": {
      const topic = rest[0];
      const jsonArg = argValue(rest, "--json");
      if (!topic || !jsonArg) throw new Error("publish requires topic and --json");
      const out = await client.publish({
        topic,
        body: parseJsonInput(jsonArg),
        runId: argValue(rest, "--run-id"),
        packFile: argValue(rest, "--pack-file"),
        durable: rest.includes("--durable"),
        dedupeKey: argValue(rest, "--dedupe-key"),
        taskId: argValue(rest, "--task-id"),
        threadId: argValue(rest, "--thread-id"),
        parentMessageId: argValue(rest, "--parent-message-id"),
        capabilities: argValue(rest, "--capabilities")
          ? (parseJsonInput(argValue(rest, "--capabilities") as string) as string[])
          : undefined,
        traceparent: argValue(rest, "--traceparent")
      });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    case "inspect": {
      const service = rest[0];
      if (!service) throw new Error("inspect requires service");
      const out = await client.inspect({ service, timeoutMs });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    case "federate": {
      const to = rest[0];
      const target = rest[1];
      const jsonArg = argValue(rest, "--json");
      if (!to || !target || !jsonArg) throw new Error("federate requires <agent@domain> <svc>.<method> and --json");
      const out = await client.federate({
        to,
        target,
        body: parseJsonInput(jsonArg),
        endpoint: argValue(rest, "--endpoint"),
        timeoutMs: argValue(rest, "--timeout-ms") ? Number(argValue(rest, "--timeout-ms")) : undefined,
        deliveryClass: argValue(rest, "--delivery-class") as "best_effort" | "durable" | "auditable" | undefined,
        e2eeKeyId: argValue(rest, "--e2ee-key-id")
      });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    case "bridge": {
      const protocol = rest[0];
      const jsonArg = argValue(rest, "--json");
      if ((protocol !== "a2a" && protocol !== "mcp") || !jsonArg) {
        throw new Error("bridge requires <a2a|mcp> and --json");
      }
      const msg = parseJsonInput(jsonArg);
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) throw new Error("bridge --json must be object");
      const out = await client.bridge({
        protocol,
        message: msg as Record<string, unknown>,
        dispatch: rest.includes("--dispatch"),
        to: argValue(rest, "--to"),
        target: argValue(rest, "--target")
      });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    case "abuse-report": {
      const reporter = argValue(rest, "--reporter");
      const subject = argValue(rest, "--subject");
      const reason = argValue(rest, "--reason");
      if (!reporter || !subject || !reason) throw new Error("abuse-report requires --reporter --subject --reason");
      const out = await client.abuseReport({
        reporter,
        subject,
        reason,
        severity: argValue(rest, "--severity") as "low" | "medium" | "high" | "critical" | undefined,
        evidence: argValue(rest, "--evidence") ? (parseJsonInput(argValue(rest, "--evidence") as string) as Record<string, unknown>) : undefined
      });
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      return;
    }
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

main().catch((err) => {
  process.stderr.write(`${JSON.stringify({ ok: false, code: "ORBIT_TS_CLI_ERROR", message: (err as Error).message })}\n`);
  process.exit(1);
});
