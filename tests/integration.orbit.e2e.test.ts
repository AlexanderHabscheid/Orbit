import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const orbitEntrypoint = path.join(repoRoot, "src", "index.ts");
const orbitExecArgs = ["--import", "tsx", orbitEntrypoint];

type CmdResult = { stdout: string; stderr: string };

async function runNode(args: string[], env: NodeJS.ProcessEnv, cwd = repoRoot): Promise<CmdResult> {
  const { stdout, stderr } = await execFileAsync(process.execPath, [...orbitExecArgs, ...args], { env, cwd, timeout: 20_000 });
  return { stdout, stderr };
}

function waitForOutput(chunks: string[], pattern: RegExp, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const iv = setInterval(() => {
      if (pattern.test(chunks.join("\n"))) {
        clearInterval(iv);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(iv);
        reject(new Error(`timeout waiting for ${pattern}; logs:\n${chunks.join("\n")}`));
      }
    }, 40);
    iv.unref?.();
  });
}

test("docker-backed orbit integration: up/serve/call/api/agent", async (t) => {
  const dockerCredentialDir = "/Applications/Docker.app/Contents/Resources/bin";
  const dockerPath = [process.env.PATH ?? "", dockerCredentialDir].filter(Boolean).join(":");
  const dockerBaseEnv: NodeJS.ProcessEnv = { ...process.env, PATH: dockerPath };
  const hasDocker = spawnSync("docker", ["version"], { stdio: "ignore", env: dockerBaseEnv }).status === 0;
  if (!hasDocker) {
    if (process.env.CI === "true") {
      assert.fail("docker is required in CI for integration coverage");
    }
    t.diagnostic("docker not available; docker-backed integration path not executed in this environment");
    return;
  }

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const containerName = `orbit-it-${suffix}`;
  const natsPort = 48000 + Math.floor(Math.random() * 1000);
  const apiPort = 49000 + Math.floor(Math.random() * 1000);
  const tmpBase = fs.mkdtempSync(`/tmp/oit-${suffix}-`);
  const dockerConfigDir = path.join(tmpBase, "docker-config");
  fs.mkdirSync(dockerConfigDir, { recursive: true });
  fs.writeFileSync(path.join(dockerConfigDir, "config.json"), "{}\n", "utf-8");
  const dockerEnv: NodeJS.ProcessEnv = { ...dockerBaseEnv, DOCKER_CONFIG: dockerConfigDir };
  const tmpHome = path.join(tmpBase, "home");
  fs.mkdirSync(tmpHome, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tmpHome,
    ORBIT_CONTEXT: "default",
    ORBIT_NATS_URL: `nats://127.0.0.1:${natsPort}`,
    ORBIT_NATS_PORT: String(natsPort),
    ORBIT_NATS_CONTAINER: containerName,
    ORBIT_DATA_DIR: path.join(tmpBase, "d"),
    ORBIT_AGENT_SOCKET: path.join(tmpBase, "a.sock"),
    ORBIT_API_TOKEN: "integration-secret",
    ORBIT_API_ALLOWED_HOSTS: "127.0.0.1,localhost,::1",
    ORBIT_LOG_LEVEL: "debug"
  };

  const cleanupProcesses: Array<ReturnType<typeof spawn>> = [];
  const cleanup = async () => {
    for (const proc of cleanupProcesses) {
      if (!proc.killed) proc.kill("SIGTERM");
    }
    await Promise.all(
      cleanupProcesses.map(
        (proc) =>
          new Promise<void>((resolve) => {
            proc.once("exit", () => resolve());
            setTimeout(() => resolve(), 1000).unref?.();
          })
      )
    );
    spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore", env: dockerEnv });
    fs.rmSync(tmpBase, { force: true, recursive: true });
  };
  t.after(async () => {
    await cleanup();
  });

  spawnSync("docker", ["rm", "-f", containerName], { stdio: "ignore", env: dockerEnv });
  const runOut = spawnSync("docker", ["run", "-d", "--name", containerName, "-p", `${natsPort}:4222`, "nats:2", "-js"], {
    encoding: "utf-8",
    env: dockerEnv
  });
  assert.equal(runOut.status, 0, runOut.stderr || "failed to start docker nats");

  const up = await runNode(["up"], env);
  const upJson = JSON.parse(up.stdout.trim()) as { status?: string };
  assert.ok(upJson.status === "running" || upJson.status === "started");

  const serveLogs: string[] = [];
  const serve = spawn(
    process.execPath,
    [...orbitExecArgs, "serve", "--name", "text", "--spec", "examples/echo.worker.spec.json", "--concurrency", "2"],
    { cwd: repoRoot, env }
  );
  cleanupProcesses.push(serve);
  serve.stderr.setEncoding("utf-8");
  serve.stderr.on("data", (chunk) => serveLogs.push(String(chunk)));
  await waitForOutput(serveLogs, /service adapter online/, 10_000);

  const call = await runNode(["call", "text.upper", "--json", '{"text":"hello"}'], env);
  const callJson = JSON.parse(call.stdout.trim()) as { ok?: boolean; result?: { echoed?: string } };
  assert.equal(callJson.ok, true);
  assert.equal(callJson.result?.echoed, "HELLO");

  const apiLogs: string[] = [];
  const api = spawn(process.execPath, [...orbitExecArgs, "api", "--host", "127.0.0.1", "--port", String(apiPort)], {
    cwd: repoRoot,
    env
  });
  cleanupProcesses.push(api);
  api.stderr.setEncoding("utf-8");
  api.stderr.on("data", (chunk) => apiLogs.push(String(chunk)));
  await waitForOutput(apiLogs, /api online/, 10_000);

  const apiRes = await fetch(`http://127.0.0.1:${apiPort}/v1/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer integration-secret"
    },
    body: JSON.stringify({ target: "text.upper", body: { text: "api" } })
  });
  assert.equal(apiRes.status, 200);
  const apiJson = (await apiRes.json()) as { ok?: boolean; payload?: { result?: { echoed?: string } } };
  assert.equal(apiJson.ok, true);
  assert.equal(apiJson.payload?.result?.echoed, "API");

  const metricsRes = await fetch(`http://127.0.0.1:${apiPort}/metrics`, {
    headers: { authorization: "Bearer integration-secret" }
  });
  assert.equal(metricsRes.status, 200);
  const metricsText = await metricsRes.text();
  assert.match(metricsText, /orbit_api_requests_total/);

  const agentLogs: string[] = [];
  const agent = spawn(process.execPath, [...orbitExecArgs, "agent"], { cwd: repoRoot, env });
  cleanupProcesses.push(agent);
  agent.stderr.setEncoding("utf-8");
  agent.stderr.on("data", (chunk) => agentLogs.push(String(chunk)));
  await waitForOutput(agentLogs, /agent online/, 10_000);

  const callViaAgent = await runNode(["call", "text.upper", "--json", '{"text":"agent"}'], env);
  const viaJson = JSON.parse(callViaAgent.stdout.trim()) as { ok?: boolean; result?: { echoed?: string } };
  assert.equal(viaJson.ok, true);
  assert.equal(viaJson.result?.echoed, "AGENT");
});
