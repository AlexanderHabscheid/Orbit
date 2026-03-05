import { OrbitError } from "../errors.js";

interface BridgeInput {
  protocol: "a2a" | "mcp";
  message: Record<string, unknown>;
}

export function normalizeBridgeMessage(input: BridgeInput): {
  targetHint?: string;
  body: unknown;
  a2a?: {
    task_id?: string;
    thread_id?: string;
    parent_message_id?: string;
    capabilities?: string[];
    traceparent?: string;
    dedupe_key?: string;
  };
} {
  if (input.protocol === "a2a") {
    const msg = input.message;
    return {
      targetHint: typeof msg.target === "string" ? msg.target : undefined,
      body: msg.payload ?? msg.body ?? msg,
      a2a: {
        task_id: typeof msg.task_id === "string" ? msg.task_id : undefined,
        thread_id: typeof msg.thread_id === "string" ? msg.thread_id : undefined,
        parent_message_id: typeof msg.parent_message_id === "string" ? msg.parent_message_id : undefined,
        capabilities: Array.isArray(msg.capabilities)
          ? msg.capabilities.filter((v): v is string => typeof v === "string")
          : undefined,
        traceparent: typeof msg.traceparent === "string" ? msg.traceparent : undefined,
        dedupe_key: typeof msg.dedupe_key === "string" ? msg.dedupe_key : undefined
      }
    };
  }

  if (input.protocol === "mcp") {
    const msg = input.message;
    if (typeof msg.method !== "string") {
      throw new OrbitError("BAD_ARGS", "mcp bridge requires message.method");
    }
    return {
      targetHint: `mcp.${msg.method}`,
      body: {
        method: msg.method,
        params: msg.params,
        id: msg.id
      }
    };
  }

  throw new OrbitError("BAD_ARGS", "unsupported bridge protocol");
}
