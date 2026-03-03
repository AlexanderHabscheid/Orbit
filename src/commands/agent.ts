import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { OrbitError } from "../errors.js";
import { Logger } from "../logger.js";
import { closeBus, connectBus } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { randomId } from "../util.js";
import { executeOrbitAction } from "../orbit_actions.js";
import { OrbitApiAction } from "../api_contract.js";
import { incCounter, setGauge } from "../metrics.js";

interface AgentRequestEnvelope {
  id: string;
  action: OrbitApiAction;
  payload: Record<string, unknown>;
}

interface AgentResponseEnvelope {
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string };
}

function extractRequestIdHint(input: string): string | undefined {
  const match = input.match(/"id"\s*:\s*"([^"\\]{1,256})"/);
  return match?.[1];
}

function parseIncomingRequest(line: string): { requestId: string; request?: AgentRequestEnvelope } {
  try {
    const raw = JSON.parse(line) as Partial<AgentRequestEnvelope>;
    const requestId = typeof raw.id === "string" && raw.id ? raw.id : randomId();
    if (
      typeof raw.action !== "string" ||
      !raw.action ||
      !raw.payload ||
      typeof raw.payload !== "object" ||
      Array.isArray(raw.payload)
    ) {
      return { requestId };
    }
    return {
      requestId,
      request: {
        id: requestId,
        action: raw.action as OrbitApiAction,
        payload: raw.payload as Record<string, unknown>
      }
    };
  } catch {
    return { requestId: randomId() };
  }
}

function writeResponse(socket: net.Socket, response: AgentResponseEnvelope): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

async function hasLiveSocket(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = net.createConnection(socketPath);
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      client.destroy();
      resolve(value);
    };
    client.once("connect", () => finish(true));
    client.once("error", () => finish(false));
    setTimeout(() => finish(false), 120).unref?.();
  });
}

async function prepareSocketPath(socketPath: string): Promise<void> {
  const socketDir = path.dirname(socketPath);
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(socketDir, 0o700);

  if (!fs.existsSync(socketPath)) return;
  const stats = fs.lstatSync(socketPath);
  if (stats.isSymbolicLink()) {
    throw new OrbitError("AGENT_SOCKET_INVALID", `refusing to remove symlink socket path ${socketPath}`);
  }
  if (stats.isSocket() && (await hasLiveSocket(socketPath))) {
    throw new OrbitError("AGENT_SOCKET_IN_USE", `agent socket already active at ${socketPath}`);
  }
  fs.rmSync(socketPath, { force: true });
}

export async function cmdAgent(config: OrbitConfig, logger: Logger): Promise<void> {
  const nc = await connectBus(config.natsUrl);
  let inFlight = 0;
  setGauge("orbit_agent_inflight", inFlight);
  await prepareSocketPath(config.agent.socketPath);

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf-8");
      if (Buffer.byteLength(buf, "utf-8") > config.runtime.agentMaxRequestBytes) {
        const requestId = extractRequestIdHint(buf) ?? randomId();
        incCounter("orbit_agent_requests_total", 1, { outcome: "payload_too_large" });
        writeResponse(socket, {
          id: requestId,
          ok: false,
          error: {
            code: "AGENT_PAYLOAD_TOO_LARGE",
            message: `agent request exceeds ${config.runtime.agentMaxRequestBytes} bytes`
          }
        });
        socket.destroy();
        return;
      }
      while (true) {
        const newline = buf.indexOf("\n");
        if (newline < 0) break;
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);
        if (!line) continue;
        if (Buffer.byteLength(line, "utf-8") > config.runtime.agentMaxRequestBytes) {
          const requestId = extractRequestIdHint(line) ?? randomId();
          incCounter("orbit_agent_requests_total", 1, { outcome: "payload_too_large" });
          writeResponse(socket, {
            id: requestId,
            ok: false,
            error: {
              code: "AGENT_PAYLOAD_TOO_LARGE",
              message: `agent request exceeds ${config.runtime.agentMaxRequestBytes} bytes`
            }
          });
          continue;
        }
        const parsed = parseIncomingRequest(line);
        if (!parsed.request) {
          incCounter("orbit_agent_requests_total", 1, { outcome: "bad_json" });
          writeResponse(socket, {
            id: parsed.requestId,
            ok: false,
            error: { code: "AGENT_BAD_JSON", message: "invalid JSON request" }
          });
          continue;
        }
        const req = parsed.request;
        if (inFlight >= config.runtime.agentMaxConcurrent) {
          incCounter("orbit_agent_requests_total", 1, { outcome: "overloaded" });
          writeResponse(socket, {
            id: req.id,
            ok: false,
            error: { code: "AGENT_OVERLOADED", message: "agent concurrency limit reached" }
          });
          continue;
        }
        inFlight += 1;
        setGauge("orbit_agent_inflight", inFlight);
        void (async () => {
          try {
            const payload = await executeOrbitAction(config, nc, req.action, req.payload, "agent");
            incCounter("orbit_agent_requests_total", 1, { action: req.action, outcome: "ok" });
            writeResponse(socket, { id: req.id, ok: true, payload });
          } catch (err) {
            incCounter("orbit_agent_requests_total", 1, {
              action: req.action,
              outcome: "error",
              code: (err as { code?: string }).code ?? "AGENT_ERROR"
            });
            writeResponse(socket, {
              id: req.id,
              ok: false,
              error: { code: (err as { code?: string }).code ?? "AGENT_ERROR", message: (err as Error).message }
            });
          } finally {
            inFlight -= 1;
            setGauge("orbit_agent_inflight", inFlight);
          }
        })();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.agent.socketPath, () => resolve());
  });
  fs.chmodSync(config.agent.socketPath, 0o600);
  logger.info("agent online", { socket: config.agent.socketPath, nats_url: config.natsUrl });

  const shutdown = async () => {
    server.close();
    try {
      fs.rmSync(config.agent.socketPath, { force: true });
    } catch {
      // best effort cleanup
    }
    try {
      await closeBus(config.natsUrl);
    } catch {
      // ignore shutdown drain failures
    }
  };

  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  await nc.closed();
}
