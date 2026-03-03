import net from "node:net";
import { EchoCore } from "./bus.js";

export interface BenchmarkResult {
  mode: "echocore" | "tcp_json";
  messages: number;
  bytes: number;
  elapsedMs: number;
  msgPerSec: number;
  mbPerSec: number;
  error?: string;
}

export async function benchmarkEchoVsNetwork(messages: number, bytes: number): Promise<BenchmarkResult[]> {
  const payload = Buffer.alloc(bytes, 7);
  const out: BenchmarkResult[] = [];
  out.push(await benchEchoCore(messages, payload));
  try {
    out.push(await benchTcpJson(messages, payload));
  } catch (err) {
    out.push({
      mode: "tcp_json",
      messages,
      bytes,
      elapsedMs: 0,
      msgPerSec: 0,
      mbPerSec: 0,
      error: (err as Error).message
    });
  }
  return out;
}

async function benchEchoCore(messages: number, payload: Uint8Array): Promise<BenchmarkResult> {
  const bus = new EchoCore({ channelSlots: Math.max(2048, messages + 16), slotBytes: payload.byteLength + 128 });
  let seen = 0;

  const stop = bus.subscribe("bench", () => {
    seen += 1;
  });

  const start = process.hrtime.bigint();
  for (let i = 0; i < messages; i += 1) {
    bus.publish("bench", payload);
  }
  const end = process.hrtime.bigint();
  stop();

  if (seen !== messages) throw new Error(`echocore benchmark mismatch: ${seen} != ${messages}`);

  const elapsedMs = Number(end - start) / 1_000_000;
  return {
    mode: "echocore",
    messages,
    bytes: payload.byteLength,
    elapsedMs,
    msgPerSec: (messages * 1000) / elapsedMs,
    mbPerSec: ((messages * payload.byteLength) / (1024 * 1024)) / (elapsedMs / 1000)
  };
}

async function benchTcpJson(messages: number, payload: Uint8Array): Promise<BenchmarkResult> {
  const payloadBase64 = Buffer.from(payload).toString("base64");
  const line = `${JSON.stringify({ channel: "bench", payloadBase64 })}\n`;

  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      socket.write(chunk);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind tcp benchmark server");

  const client = await new Promise<net.Socket>((resolve, reject) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: address.port });
    sock.once("error", reject);
    sock.once("connect", () => resolve(sock));
  });
  client.setEncoding("utf-8");

  let seen = 0;
  let buffered = "";
  const done = new Promise<void>((resolve) => {
    client.on("data", (chunk) => {
      buffered += chunk;
      for (;;) {
        const idx = buffered.indexOf("\n");
        if (idx < 0) break;
        buffered = buffered.slice(idx + 1);
        seen += 1;
        if (seen === messages) resolve();
      }
    });
  });

  const start = process.hrtime.bigint();
  for (let i = 0; i < messages; i += 1) {
    client.write(line);
  }
  await done;
  const end = process.hrtime.bigint();

  client.end();
  client.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const elapsedMs = Number(end - start) / 1_000_000;
  return {
    mode: "tcp_json",
    messages,
    bytes: payload.byteLength,
    elapsedMs,
    msgPerSec: (messages * 1000) / elapsedMs,
    mbPerSec: ((messages * payload.byteLength) / (1024 * 1024)) / (elapsedMs / 1000)
  };
}
