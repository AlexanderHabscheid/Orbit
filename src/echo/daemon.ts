import fs from "node:fs";
import net from "node:net";
import { EchoCore } from "./bus.js";
import { DaemonStartOptions, EchoCoreOptions, EchoMessage } from "./types.js";

interface StartResult {
  close: () => Promise<void>;
  socketPath?: string;
  tcpPort?: number;
}

interface CommandPublish {
  type: "publish";
  channel: string;
  payloadBase64: string;
}

interface CommandSubscribe {
  type: "subscribe";
  channel: string;
  fromLatest?: boolean;
}

interface CommandStats {
  type: "stats";
  channel?: string;
}

type ClientCommand = CommandPublish | CommandSubscribe | CommandStats;

interface SocketWriter {
  send: (payload: unknown) => void;
  close: () => void;
}

const DEFAULT_SOCKET_PATH = "/tmp/echocore.sock";
const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024;

export async function startEchoDaemon(options: DaemonStartOptions = {}): Promise<StartResult> {
  const busOptions: EchoCoreOptions = {
    channelsMax: options.channelsMax,
    channelSlots: options.channelSlots,
    slotBytes: options.slotBytes,
    backpressure: options.backpressure
  };

  const bus = new EchoCore(busOptions);
  const servers: net.Server[] = [];

  const makeHandler = () => (socket: net.Socket) => {
    const writer = createSocketWriter(socket, options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES);
    let unsubscriber: (() => void) | undefined;
    let buffered = "";

    const cleanup = (): void => {
      if (unsubscriber) {
        unsubscriber();
        unsubscriber = undefined;
      }
      writer.close();
    };

    socket.setEncoding("utf-8");
    socket.on("data", (chunk) => {
      buffered += chunk;
      for (;;) {
        const idx = buffered.indexOf("\n");
        if (idx < 0) break;
        const line = buffered.slice(0, idx).trim();
        buffered = buffered.slice(idx + 1);
        if (!line) continue;

        let cmd: ClientCommand;
        try {
          cmd = JSON.parse(line) as ClientCommand;
        } catch {
          writer.send({ ok: false, error: "invalid_json" });
          continue;
        }

        if (cmd.type === "publish") {
          try {
            const payload = Buffer.from(cmd.payloadBase64, "base64");
            const result = bus.publish(cmd.channel, payload);
            writer.send({ ok: true, type: "ack", seq: result.seq, dropped: result.dropped, accepted: result.accepted });
          } catch (err) {
            writer.send({ ok: false, error: (err as Error).message });
          }
          continue;
        }

        if (cmd.type === "subscribe") {
          if (unsubscriber) unsubscriber();
          unsubscriber = bus.subscribe(
            cmd.channel,
            (message: EchoMessage) => {
              writer.send({
                ok: true,
                type: "event",
                channel: message.channel,
                seq: message.seq,
                ts: message.ts,
                payloadBase64: Buffer.from(message.payload).toString("base64")
              });
            },
            {
              fromLatest: cmd.fromLatest,
              onDrop: (gap) => {
                writer.send({ ok: true, type: "drop", channel: cmd.channel, dropped: gap });
              }
            }
          );
          writer.send({ ok: true, type: "subscribed", channel: cmd.channel });
          continue;
        }

        if (cmd.type === "stats") {
          writer.send({ ok: true, type: "stats", channels: bus.stats(cmd.channel) });
          continue;
        }

        writer.send({ ok: false, error: "unsupported_command" });
      }
    });

    socket.on("error", cleanup);
    socket.on("close", cleanup);
  };

  let socketPath: string | undefined;
  if (options.socketPath !== "off") {
    socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    const unixServer = net.createServer(makeHandler());
    await listen(unixServer, socketPath);
    servers.push(unixServer);
  }

  let tcpPort: number | undefined;
  if (options.tcpPort !== undefined) {
    const tcpServer = net.createServer(makeHandler());
    await listen(tcpServer, options.tcpPort);
    servers.push(tcpServer);
    const addr = tcpServer.address();
    if (addr && typeof addr === "object") tcpPort = addr.port;
  }

  return {
    socketPath,
    tcpPort,
    close: async () => {
      await Promise.all(servers.map((server) => closeServer(server)));
      if (socketPath && fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    }
  };
}

function createSocketWriter(socket: net.Socket, maxPendingBytes: number): SocketWriter {
  const queue: string[] = [];
  let pendingBytes = 0;
  let draining = false;
  let closed = false;

  const flush = (): void => {
    if (closed || !draining) return;
    while (queue.length > 0) {
      const frame = queue.shift();
      if (!frame) continue;
      pendingBytes -= Buffer.byteLength(frame);
      const ok = socket.write(frame);
      if (!ok) {
        draining = true;
        return;
      }
    }
    draining = false;
  };

  socket.on("drain", flush);

  return {
    send(payload: unknown) {
      if (closed) return;
      const frame = `${JSON.stringify(payload)}\n`;
      if (draining) {
        queue.push(frame);
        pendingBytes += Buffer.byteLength(frame);
        if (pendingBytes > maxPendingBytes) {
          closed = true;
          socket.destroy(new Error("backpressure_limit_exceeded"));
        }
        return;
      }

      const ok = socket.write(frame);
      if (!ok) {
        draining = true;
      }
    },
    close() {
      closed = true;
      queue.length = 0;
      pendingBytes = 0;
    }
  };
}

function listen(server: net.Server, endpoint: string | number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
