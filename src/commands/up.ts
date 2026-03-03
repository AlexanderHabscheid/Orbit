import { spawnSync, spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { OrbitConfig } from "../types.js";
import { closeBus, connectBus } from "../nats.js";
import { Logger } from "../logger.js";
import { ensureDir } from "../util.js";

function isDockerAvailable(): boolean {
  const out = spawnSync("docker", ["version"], { stdio: "ignore" });
  return out.status === 0;
}

function dockerContainerRunning(name: string): boolean {
  const out = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf-8" });
  return out.status === 0 && out.stdout.trim() === "true";
}

function startDockerBroker(config: OrbitConfig): void {
  const { containerName, dockerImage, port } = config.broker;
  if (dockerContainerRunning(containerName)) return;

  const exists = spawnSync("docker", ["inspect", containerName], { stdio: "ignore" }).status === 0;
  if (exists) {
    const res = spawnSync("docker", ["start", containerName], { stdio: "inherit" });
    if (res.status !== 0) throw new Error("failed to start existing docker nats container");
    return;
  }
  const res = spawnSync(
    "docker",
    ["run", "-d", "--name", containerName, "-p", `${port}:4222`, dockerImage, "-js"],
    { stdio: "inherit" }
  );
  if (res.status !== 0) throw new Error("failed to run docker nats container");
}

function startLocalBroker(config: OrbitConfig): boolean {
  const which = spawnSync("which", ["nats-server"], { encoding: "utf-8" });
  if (which.status !== 0) return false;
  const natsServer = which.stdout.trim();
  const pidFile = path.join(config.dataDir, "nats-server.pid");
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf-8"));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        fs.rmSync(pidFile, { force: true });
      }
    }
  }

  const storeDir = path.join(config.dataDir, "jetstream");
  ensureDir(storeDir);
  const child = spawn(natsServer, ["-js", "-p", String(config.broker.port), "--store_dir", storeDir], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid), "utf-8");
  return true;
}

export async function cmdUp(config: OrbitConfig, logger: Logger): Promise<void> {
  try {
    await connectBus(config.natsUrl);
    await closeBus(config.natsUrl);
    process.stdout.write(
      `${JSON.stringify({ status: "running", nats_url: config.natsUrl, strategy: "already_running" }, null, 2)}\n`
    );
    return;
  } catch {
    logger.info("nats broker not currently reachable", { url: config.natsUrl });
  }

  const startedLocal = startLocalBroker(config);
  if (!startedLocal) {
    if (!isDockerAvailable()) {
      throw new Error("nats-server not installed and docker unavailable. install nats-server or docker.");
    }
    startDockerBroker(config);
  }

  const start = Date.now();
  while (Date.now() - start < 7000) {
    try {
      await connectBus(config.natsUrl);
      await closeBus(config.natsUrl);
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "started",
            nats_url: config.natsUrl,
            strategy: startedLocal ? "local_nats_server" : "docker"
          },
          null,
          2
        )}\n`
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`broker did not become reachable at ${config.natsUrl}`);
}
