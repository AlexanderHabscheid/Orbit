import net from "node:net";
import { OrbitError } from "./errors.js";
import { OrbitConfig } from "./types.js";
import { OrbitApiAction } from "./api_contract.js";

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

function connectSocket(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitForResponse(socket: net.Socket, requestId: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new OrbitError("AGENT_TIMEOUT", `agent request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();

    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      while (true) {
        const newline = buf.indexOf("\n");
        if (newline < 0) break;
        const line = buf.slice(0, newline).trim();
        buf = buf.slice(newline + 1);
        if (!line) continue;
        let parsed: AgentResponseEnvelope;
        try {
          parsed = JSON.parse(line) as AgentResponseEnvelope;
        } catch {
          continue;
        }
        if (parsed.id !== requestId) continue;
        cleanup();
        socket.end();
        if (!parsed.ok) {
          reject(new OrbitError(parsed.error?.code ?? "AGENT_ERROR", parsed.error?.message ?? "agent request failed"));
          return;
        }
        resolve(parsed.payload);
        return;
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new OrbitError("AGENT_IO_ERROR", "agent socket error", { err }));
    };
    const onClose = () => {
      cleanup();
      reject(new OrbitError("AGENT_CLOSED", "agent socket closed before response"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

export async function requestAgent(
  config: OrbitConfig,
  action: OrbitApiAction,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<unknown> {
  if (!config.agent.enabled) throw new OrbitError("AGENT_DISABLED", "agent mode disabled");
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const socket = await connectSocket(config.agent.socketPath);
  const req: AgentRequestEnvelope = { id, action, payload };
  socket.write(`${JSON.stringify(req)}\n`);
  return waitForResponse(socket, id, timeoutMs);
}

export function canUseAgent(config: OrbitConfig): boolean {
  return Boolean(config.agent.enabled && config.agent.socketPath);
}
