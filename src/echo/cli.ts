import fs from "node:fs";
import { connectEchoClient } from "./client.js";
import { benchmarkEchoVsNetwork } from "./benchmark.js";
import { startEchoDaemon } from "./daemon.js";

function usage(): string {
  return `echocore - local zero-copy event bus\n\nUsage:\n  echocore start [--socket /tmp/echocore.sock] [--tcp-port 7777] [--channel-slots 1024] [--slot-bytes 65536] [--channels-max 256] [--backpressure drop_oldest|drop_newest]\n  echocore publish --channel agent.loop --json @event.json [--socket /tmp/echocore.sock] [--host 127.0.0.1 --port 7777]\n  echocore subscribe --channel agent.loop [--from-latest] [--socket /tmp/echocore.sock] [--host 127.0.0.1 --port 7777]\n  echocore stats [--channel agent.loop] [--socket /tmp/echocore.sock]\n  echocore bench [--messages 50000] [--bytes 1024]\n`;
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseJsonInput(input: string): unknown {
  if (input.startsWith("@")) {
    return JSON.parse(fs.readFileSync(input.slice(1), "utf-8"));
  }
  return JSON.parse(input);
}

function endpointFromArgs(args: string[]): { socketPath?: string; host?: string; port?: number } {
  const socketPath = argValue(args, "--socket");
  const host = argValue(args, "--host");
  const portRaw = argValue(args, "--port");
  const port = portRaw ? Number(portRaw) : undefined;
  return { socketPath, host, port };
}

export async function runEchoCli(argv: string[]): Promise<void> {
  if (argv.length === 0 || hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    process.stdout.write(usage());
    return;
  }

  const [command, ...rest] = argv;
  if (command === "start") {
    const daemon = await startEchoDaemon({
      socketPath: argValue(rest, "--socket"),
      tcpPort: argValue(rest, "--tcp-port") ? Number(argValue(rest, "--tcp-port")) : undefined,
      channelSlots: argValue(rest, "--channel-slots") ? Number(argValue(rest, "--channel-slots")) : undefined,
      slotBytes: argValue(rest, "--slot-bytes") ? Number(argValue(rest, "--slot-bytes")) : undefined,
      channelsMax: argValue(rest, "--channels-max") ? Number(argValue(rest, "--channels-max")) : undefined,
      backpressure: (argValue(rest, "--backpressure") as "drop_oldest" | "drop_newest" | undefined) ?? "drop_oldest"
    });

    process.stdout.write(`${JSON.stringify({ ok: true, socketPath: daemon.socketPath, tcpPort: daemon.tcpPort })}\n`);
    const shutdown = async (): Promise<void> => {
      await daemon.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    await new Promise(() => undefined);
    return;
  }

  if (command === "publish") {
    const channel = argValue(rest, "--channel");
    const jsonArg = argValue(rest, "--json");
    if (!channel || !jsonArg) throw new Error("publish requires --channel and --json");

    const body = parseJsonInput(jsonArg);
    const payload = Buffer.from(JSON.stringify(body));
    const client = await connectEchoClient(endpointFromArgs(rest));

    await new Promise<void>((resolve, reject) => {
      client.onLine((line) => {
        const response = JSON.parse(line) as {
          ok: boolean;
          error?: string;
          seq?: number;
          dropped?: number;
          accepted?: boolean;
        };
        if (!response.ok) {
          client.close();
          reject(new Error(response.error ?? "publish failed"));
          return;
        }
        process.stdout.write(
          `${JSON.stringify({ ok: true, channel, seq: response.seq, dropped: response.dropped, accepted: response.accepted })}\n`
        );
        client.close();
        resolve();
      });
      client.send({ type: "publish", channel, payloadBase64: payload.toString("base64") });
    });
    return;
  }

  if (command === "subscribe") {
    const channel = argValue(rest, "--channel");
    if (!channel) throw new Error("subscribe requires --channel");

    const fromLatest = hasFlag(rest, "--from-latest");
    const client = await connectEchoClient(endpointFromArgs(rest));
    client.onLine((line) => {
      const msg = JSON.parse(line) as {
        ok: boolean;
        type: "subscribed" | "event" | "drop";
        payloadBase64?: string;
        dropped?: number;
        seq?: number;
        ts?: number;
      };
      if (!msg.ok) return;
      if (msg.type === "event") {
        const payloadText = Buffer.from(msg.payloadBase64 ?? "", "base64").toString("utf-8");
        process.stdout.write(`${JSON.stringify({ channel, seq: msg.seq, ts: msg.ts, payload: JSON.parse(payloadText) })}\n`);
        return;
      }
      if (msg.type === "drop") {
        process.stderr.write(`dropped=${msg.dropped}\n`);
      }
    });

    client.send({ type: "subscribe", channel, fromLatest });
    await new Promise(() => undefined);
    return;
  }

  if (command === "stats") {
    const client = await connectEchoClient(endpointFromArgs(rest));
    const channel = argValue(rest, "--channel");

    await new Promise<void>((resolve, reject) => {
      client.onLine((line) => {
        const msg = JSON.parse(line) as { ok: boolean; type: string; channels?: unknown[]; error?: string };
        if (!msg.ok) {
          client.close();
          reject(new Error(msg.error ?? "stats failed"));
          return;
        }
        if (msg.type !== "stats") return;
        process.stdout.write(`${JSON.stringify({ ok: true, channels: msg.channels }, null, 2)}\n`);
        client.close();
        resolve();
      });
      client.send({ type: "stats", channel });
    });
    return;
  }

  if (command === "bench") {
    const messages = Number(argValue(rest, "--messages") ?? "50000");
    const bytes = Number(argValue(rest, "--bytes") ?? "1024");
    if (!Number.isInteger(messages) || messages < 1) throw new Error("--messages must be an integer > 0");
    if (!Number.isInteger(bytes) || bytes < 64) throw new Error("--bytes must be an integer >= 64");

    const results = await benchmarkEchoVsNetwork(messages, bytes);
    process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}
