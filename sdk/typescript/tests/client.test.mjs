import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OrbitClient, OrbitApiError } from "../dist/client.js";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

test("OrbitClient maps unauthorized API errors", async () => {
  const server = http.createServer((_, res) => {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "1", ok: false, error: { code: "UNAUTHORIZED", message: "missing token" } }));
  });
  const baseUrl = await listen(server);
  const client = new OrbitClient({ baseUrl });
  await assert.rejects(
    () => client.ping(),
    (err) => err instanceof OrbitApiError && err.code === "UNAUTHORIZED" && err.status === 401
  );
  server.close();
});

test("OrbitClient honors per-call timeout overrides", async () => {
  const server = http.createServer((_, res) => {
    setTimeout(() => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "1", ok: true, payload: { ok: true } }));
    }, 100);
  });
  const baseUrl = await listen(server);
  const client = new OrbitClient({ baseUrl, timeoutMs: 2000 });
  await assert.rejects(
    () => client.call({ target: "svc.echo", body: { text: "x" }, timeoutMs: 10 }),
    (err) => err instanceof OrbitApiError && err.code === "TIMEOUT"
  );
  server.close();
});

test("OrbitClient sends call payload fields with API parity", async () => {
  let received = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "1", ok: true, payload: { ok: true } }));
  });
  const baseUrl = await listen(server);
  const client = new OrbitClient({ baseUrl });
  await client.call({
    target: "svc.upper",
    body: { text: "hello" },
    timeoutMs: 1234,
    retries: 2,
    runId: "run-123",
    packFile: "/tmp/blob.bin",
    taskId: "task-1",
    threadId: "thread-9",
    parentMessageId: "msg-0",
    capabilities: ["search", "retrieve"],
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    dedupeKey: "call-dedupe-1"
  });
  assert.deepEqual(received, {
    target: "svc.upper",
    body: { text: "hello" },
    timeoutMs: 1234,
    retries: 2,
    runId: "run-123",
    packFile: "/tmp/blob.bin",
    taskId: "task-1",
    threadId: "thread-9",
    parentMessageId: "msg-0",
    capabilities: ["search", "retrieve"],
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    dedupeKey: "call-dedupe-1"
  });
  server.close();
});
