import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startEchoDaemon } from "../echo/daemon.js";
import { connectEchoClient } from "../echo/client.js";
import { Logger } from "../logger.js";
import { OrbitConfig } from "../types.js";
import { ensureDir, randomId } from "../util.js";
import { runCellGateway } from "../cell/gateway.js";
import { CellRouteMode, resolveCellRoutingPlan } from "../cell/routing.js";
import { buildCellRoutesTemplate, CellProfile } from "../cell/template.js";

interface CellStatusFile {
  cellId: string;
  pid: number;
  startedAt: string;
  socketPath?: string;
  tcpPort?: number;
  gateway: boolean;
  routes: Array<{ channel: string; mode: string; subject: string }>;
  source?: string;
}

function cellStatusPath(config: OrbitConfig): string {
  return path.join(config.dataDir, "cell", "status.json");
}

function parseChannels(args: string[]): string[] {
  const channels: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--channel" && i + 1 < args.length) channels.push(args[i + 1]);
  }
  return channels;
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseMode(value: string | undefined): CellRouteMode {
  if (value === "local_only" || value === "replicate" || value === "global_only") return value;
  return "replicate";
}

function parseProfile(value: string | undefined): CellProfile {
  if (value === "high_throughput") return "high_throughput";
  return "production";
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fetchEchoStats(socketPath?: string, host?: string, port?: number): Promise<unknown[] | null> {
  try {
    const client = await connectEchoClient({ socketPath, host, port });
    const response = await new Promise<unknown[] | null>((resolve) => {
      client.onLine((line) => {
        const msg = JSON.parse(line) as { ok?: boolean; type?: string; channels?: unknown[] };
        if (!msg.ok || msg.type !== "stats") {
          resolve(null);
          client.close();
          return;
        }
        resolve(msg.channels ?? []);
        client.close();
      });
      client.send({ type: "stats" });
    });
    return response;
  } catch {
    return null;
  }
}

export async function cmdCell(config: OrbitConfig, logger: Logger, args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "--help" || sub === "-h") {
    process.stdout.write(
      `orbit cell usage:\n  orbit cell init [--out ./examples/cell.routes.production.json] [--profile production|high_throughput] [--subject-prefix orbit] [--force]\n  orbit cell start [--socket /tmp/echocore.sock] [--tcp-port 7777] [--gateway] [--cell-id <id>] [--routes @routes.json] [--channel <name> ...] [--mode local_only|replicate|global_only]\n  orbit cell gateway [--socket /tmp/echocore.sock] [--cell-id <id>] [--routes @routes.json] [--channel <name> ...] [--mode local_only|replicate|global_only]\n  orbit cell status [--socket /tmp/echocore.sock]\n`
    );
    return;
  }

  if (sub === "init") {
    const out = argValue(args, "--out") ?? path.join(process.cwd(), "examples", "cell.routes.production.json");
    const profile = parseProfile(argValue(args, "--profile"));
    const subjectPrefix = argValue(args, "--subject-prefix") ?? config.routing.subjectPrefix;
    const force = hasFlag(args, "--force");
    if (fs.existsSync(out) && !force) {
      throw new Error(`output exists: ${out} (use --force to overwrite)`);
    }

    const template = buildCellRoutesTemplate(profile, subjectPrefix);
    ensureDir(path.dirname(out));
    fs.writeFileSync(out, `${JSON.stringify(template, null, 2)}\n`, "utf-8");
    process.stdout.write(`${JSON.stringify({ ok: true, file: out, profile, routes: Object.keys(template).length }, null, 2)}\n`);
    return;
  }

  if (sub === "start") {
    const socketPath = argValue(args, "--socket") ?? path.join(config.dataDir, "echocore.sock");
    const tcpPort = argValue(args, "--tcp-port") ? Number(argValue(args, "--tcp-port")) : undefined;
    const cellId = argValue(args, "--cell-id") ?? `${os.hostname()}-${randomId().slice(0, 8)}`;
    const routesFileArg = argValue(args, "--routes");
    const routesFile = routesFileArg?.startsWith("@") ? routesFileArg.slice(1) : routesFileArg;
    const channels = parseChannels(args);
    const mode = parseMode(argValue(args, "--mode"));
    const gateway = hasFlag(args, "--gateway") || hasFlag(args, "--with-gateway");

    const routing = resolveCellRoutingPlan(config, { routesFile, channels, defaultMode: mode });
    const daemon = await startEchoDaemon({ socketPath, tcpPort });

    const statusPath = cellStatusPath(config);
    ensureDir(path.dirname(statusPath));
    const status: CellStatusFile = {
      cellId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      socketPath: daemon.socketPath,
      tcpPort: daemon.tcpPort,
      gateway,
      source: routing.source,
      routes: routing.routes.map((route) => ({ channel: route.channel, mode: route.mode, subject: route.subject }))
    };
    fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf-8");

    process.stdout.write(`${JSON.stringify({ ok: true, mode: "cell", daemon: { socketPath: daemon.socketPath, tcpPort: daemon.tcpPort }, gateway, cellId }, null, 2)}\n`);

    if (gateway) {
      await runCellGateway(config, logger, {
        socketPath: daemon.socketPath,
        port: daemon.tcpPort,
        cellId,
        routes: routing.routes,
        fromLatest: true
      });
      return;
    }

    const shutdown = async (): Promise<void> => {
      await daemon.close();
      process.exit(0);
    };
    process.once("SIGINT", () => {
      void shutdown();
    });
    process.once("SIGTERM", () => {
      void shutdown();
    });
    await new Promise(() => undefined);
    return;
  }

  if (sub === "gateway") {
    const socketPath = argValue(args, "--socket") ?? path.join(config.dataDir, "echocore.sock");
    const routesFileArg = argValue(args, "--routes");
    const routesFile = routesFileArg?.startsWith("@") ? routesFileArg.slice(1) : routesFileArg;
    const channels = parseChannels(args);
    const mode = parseMode(argValue(args, "--mode"));
    const cellId = argValue(args, "--cell-id") ?? `${os.hostname()}-${randomId().slice(0, 8)}`;
    const host = argValue(args, "--host");
    const port = argValue(args, "--port") ? Number(argValue(args, "--port")) : undefined;
    const routing = resolveCellRoutingPlan(config, { routesFile, channels, defaultMode: mode });

    process.stdout.write(
      `${JSON.stringify({ ok: true, mode: "gateway", cellId, socketPath, routes: routing.routes.map((route) => ({ channel: route.channel, mode: route.mode, subject: route.subject })) }, null, 2)}\n`
    );

    await runCellGateway(config, logger, {
      socketPath,
      host,
      port,
      cellId,
      routes: routing.routes,
      fromLatest: true
    });
    return;
  }

  if (sub === "status") {
    const statusPath = cellStatusPath(config);
    const saved = fs.existsSync(statusPath)
      ? (JSON.parse(fs.readFileSync(statusPath, "utf-8")) as CellStatusFile)
      : null;

    const socketPath = argValue(args, "--socket") ?? saved?.socketPath;
    const host = argValue(args, "--host");
    const port = argValue(args, "--port") ? Number(argValue(args, "--port")) : saved?.tcpPort;
    const stats = await fetchEchoStats(socketPath, host, port);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          status: saved
            ? {
                ...saved,
                alive: isPidAlive(saved.pid)
              }
            : null,
          echo: {
            endpoint: socketPath ?? (port ? `${host ?? "127.0.0.1"}:${port}` : null),
            connected: stats !== null,
            channels: stats
          }
        },
        null,
        2
      )}\n`
    );
    return;
  }

  throw new Error(`unknown cell subcommand: ${sub}`);
}
