import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeMethod } from "../src/service_adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("executeMethod supports http transport", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("bad method");
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk);
    });
    req.on("end", () => {
      const payload = JSON.parse(body) as { text?: string };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ echoed: (payload.text ?? "").toUpperCase() }));
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.off("listening", onListening);
        reject(err);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") {
      t.skip("sandbox does not allow binding localhost sockets");
      return;
    }
    throw err;
  }
  const addr = server.address();
  assert(addr && typeof addr === "object");
  const endpoint = `http://127.0.0.1:${addr.port}/echo`;
  try {
    const out = await executeMethod(
      { transport: "http", http_endpoint: endpoint, http_method: "POST" },
      { text: "orbit" },
      1000
    );
    assert.deepEqual(out, { echoed: "ORBIT" });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("executeMethod supports worker transport", async () => {
  const fixture = path.join(__dirname, "fixtures", "echo_worker.js");
  const out = await executeMethod(
    {
      transport: "worker",
      command: process.execPath,
      args: [fixture]
    },
    { text: "worker" },
    1000
  );
  assert.deepEqual(out, { echoed: "WORKER" });
});

test("executeMethod enforces request/response schemas", async () => {
  const fixture = path.join(__dirname, "fixtures", "echo_worker.js");
  const method = {
    transport: "worker" as const,
    command: process.execPath,
    args: [fixture],
    request_schema: {
      type: "object",
      required: ["text"],
      additionalProperties: false,
      properties: { text: { type: "string", minLength: 1 } }
    },
    response_schema: {
      type: "object",
      required: ["echoed"],
      additionalProperties: false,
      properties: { echoed: { type: "string" } }
    }
  };
  await assert.rejects(() => executeMethod(method, { bad: true }, 1000), /schema validation/);
  const out = await executeMethod(method, { text: "schema" }, 1000);
  assert.deepEqual(out, { echoed: "SCHEMA" });
});

test("executeMethod applies worker backpressure limits", async () => {
  const fixture = path.join(__dirname, "fixtures", "slow_worker.js");
  const first = executeMethod(
    {
      transport: "worker",
      command: process.execPath,
      args: [fixture]
    },
    { text: "one" },
    2000,
    { poolSize: 1, maxPendingPerWorker: 1 }
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  await assert.rejects(
    () =>
      executeMethod(
        {
          transport: "worker",
          command: process.execPath,
          args: [fixture]
        },
        { text: "two" },
        2000,
        { poolSize: 1, maxPendingPerWorker: 1 }
      ),
    /max pending capacity/
  );

  await first;
});
