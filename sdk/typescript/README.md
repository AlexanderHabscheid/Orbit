# Orbit TypeScript SDK

TypeScript client and CLI for the Orbit external API (`orbit api`).

## Usage

```ts
import { OrbitClient } from "orbit-sdk-typescript";

const client = new OrbitClient({ baseUrl: "http://127.0.0.1:8787" });
const out = await client.call({
  target: "text.upper",
  body: { text: "hello" },
  timeoutMs: 3000,
  retries: 1,
  packFile: "./blob.bin",
  taskId: "task-1",
  threadId: "thread-1",
  parentMessageId: "msg-0",
  capabilities: ["search"],
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
  dedupeKey: "call-1"
});
console.log(out);
```

CLI:

```bash
orbit-ts call text.upper --json '{"text":"hello"}' --base-url http://127.0.0.1:8787 --timeout-ms 3000 --retries 1 --pack-file ./blob.bin --task-id task-1 --thread-id thread-1 --parent-message-id msg-0 --capabilities '["search"]' --traceparent '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00' --dedupe-key call-1
orbit-ts call text.upper --json '{"text":"hello"}' --token "$ORBIT_API_TOKEN"
```
