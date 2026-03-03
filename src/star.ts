import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { closeBus, connectBus } from "./nats.js";
import { OrbitConfig } from "./types.js";
import { ensureDir } from "./util.js";

export type StarProfile = "single-agent" | "multi-agent" | "production";
export type StarCheckStatus = "pass" | "warn" | "fail";

export interface StarCheck {
  id: string;
  status: StarCheckStatus;
  summary: string;
  fix?: string;
}

export interface StarDoctorReport {
  module: "Star";
  ok: boolean;
  checkedAt: string;
  checks: StarCheck[];
}

export interface StarInitSummary {
  module: "Star";
  profile: StarProfile;
  baseDir: string;
  created: string[];
  skipped: string[];
  nextSteps: string[];
}

const STAR_REQUEST_JSON = {
  text: "hello from star"
};

const STAR_SPEC_JSON = {
  version: "1.0.0",
  description: "Star starter worker service",
  methods: {
    upper: {
      description: "Uppercase request text",
      transport: "worker",
      command: "node",
      args: ["-e", "process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){const line=b.slice(0,i);b=b.slice(i+1);if(!line.trim())continue;const msg=JSON.parse(line);const text=String(msg?.payload?.text??'');console.log(JSON.stringify({id:msg.id,ok:true,result:{text:text.toUpperCase()}}));}});"]
    }
  }
};

function starConfig(profile: StarProfile): Record<string, unknown> {
  if (profile === "production") {
    return {
      natsUrl: "nats://127.0.0.1:4222",
      requestTimeoutMs: 3000,
      retries: 1,
      api: {
        authToken: "change-me",
        allowedHosts: ["127.0.0.1", "localhost", "::1"]
      },
      runtime: {
        apiMaxConcurrent: 256,
        apiRequestTimeoutMs: 10000,
        publishDurableEnabled: true,
        publishDurableTimeoutMs: 2500
      }
    };
  }
  if (profile === "multi-agent") {
    return {
      natsUrl: "nats://127.0.0.1:4222",
      requestTimeoutMs: 4000,
      retries: 2,
      runtime: {
        apiMaxConcurrent: 192,
        monitorMaxParallel: 16
      }
    };
  }
  return {
    natsUrl: "nats://127.0.0.1:4222",
    requestTimeoutMs: 5000,
    retries: 2
  };
}

function starCompose(profile: StarProfile): string {
  const tokenBlock =
    profile === "production"
      ? "      ORBIT_API_TOKEN: ${ORBIT_API_TOKEN:-change-me}\n"
      : "";
  return `services:
  nats:
    image: nats:2
    command: ["-js"]
    ports:
      - "4222:4222"

  orbit-api:
    image: node:20
    working_dir: /workspace
    volumes:
      - ./:/workspace
    command: ["npx", "orbit", "api", "--host", "0.0.0.0", "--port", "8787"]
    environment:
${tokenBlock}      ORBIT_NATS_URL: nats://nats:4222
    depends_on:
      - nats
    ports:
      - "8787:8787"
`;
}

function writeIfAllowed(
  absolutePath: string,
  content: string,
  force: boolean,
  created: string[],
  skipped: string[]
): void {
  if (fs.existsSync(absolutePath) && !force) {
    skipped.push(absolutePath);
    return;
  }
  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, content, "utf-8");
  created.push(absolutePath);
}

export function runStarInit(opts: {
  cwd: string;
  baseDir: string;
  profile: StarProfile;
  force: boolean;
}): StarInitSummary {
  const created: string[] = [];
  const skipped: string[] = [];
  const base = path.resolve(opts.cwd, opts.baseDir);
  const configPath = path.join(base, ".orbit", "config.json");
  const specPath = path.join(base, "examples", "star", "echo.worker.spec.json");
  const reqPath = path.join(base, "examples", "star", "request.json");
  const composePath = path.join(base, "docker-compose.star.yml");
  const ciPath = path.join(base, "examples", "star", "ci-call.sh");
  const starReadmeJsonPath = path.join(base, "examples", "star", "README.star.json");

  writeIfAllowed(configPath, `${JSON.stringify(starConfig(opts.profile), null, 2)}\n`, opts.force, created, skipped);
  writeIfAllowed(specPath, `${JSON.stringify(STAR_SPEC_JSON, null, 2)}\n`, opts.force, created, skipped);
  writeIfAllowed(reqPath, `${JSON.stringify(STAR_REQUEST_JSON, null, 2)}\n`, opts.force, created, skipped);
  writeIfAllowed(composePath, starCompose(opts.profile), opts.force, created, skipped);
  writeIfAllowed(
    ciPath,
    `#!/usr/bin/env bash
set -euo pipefail
orbit up
orbit serve --name text --spec examples/star/echo.worker.spec.json &
SERVE_PID=$!
trap 'kill "$SERVE_PID" >/dev/null 2>&1 || true' EXIT
sleep 1
orbit call text.upper --json @examples/star/request.json
`,
    opts.force,
    created,
    skipped
  );

  if (created.includes(ciPath)) {
    fs.chmodSync(ciPath, 0o755);
  }

  writeIfAllowed(
    starReadmeJsonPath,
    `${JSON.stringify(
      {
        module: "Star",
        profile: opts.profile,
        created_at: new Date().toISOString(),
        commands: [
          "orbit up",
          "orbit serve --name text --spec examples/star/echo.worker.spec.json",
          "orbit call text.upper --json @examples/star/request.json",
          "orbit api --host 127.0.0.1 --port 8787"
        ]
      },
      null,
      2
    )}\n`,
    opts.force,
    created,
    skipped
  );

  return {
    module: "Star",
    profile: opts.profile,
    baseDir: base,
    created,
    skipped,
    nextSteps: [
      `cd ${base}`,
      "orbit up",
      "orbit serve --name text --spec examples/star/echo.worker.spec.json",
      "orbit call text.upper --json @examples/star/request.json",
      "orbit doctor"
    ]
  };
}

async function checkNatsConnectivity(url: string): Promise<StarCheck> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), 1500);
      timer.unref?.();
    });
    await Promise.race([connectBus(url), timeout]);
    await closeBus(url);
    return { id: "nats-connectivity", status: "pass", summary: `connected to ${url}` };
  } catch {
    return {
      id: "nats-connectivity",
      status: "fail",
      summary: `cannot reach NATS at ${url}`,
      fix: "Run `orbit up` or set a valid ORBIT_NATS_URL."
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function checkNodeRuntime(): StarCheck {
  const major = Number(process.versions.node.split(".")[0] ?? "0");
  if (major >= 20) {
    return { id: "node-runtime", status: "pass", summary: `node ${process.versions.node}` };
  }
  return {
    id: "node-runtime",
    status: "fail",
    summary: `node ${process.versions.node} is below required >=20`,
    fix: "Upgrade Node.js to v20+."
  };
}

function checkDocker(): StarCheck {
  const out = spawnSync("docker", ["version"], { stdio: "ignore" });
  if (out.status === 0) return { id: "docker", status: "pass", summary: "docker available" };
  return {
    id: "docker",
    status: "warn",
    summary: "docker unavailable",
    fix: "Install Docker Desktop to use docker-compose.star.yml quickstart."
  };
}

function checkDirWritable(dirPath: string): StarCheck {
  try {
    ensureDir(dirPath);
    const probe = path.join(dirPath, ".orbit-write-probe");
    fs.writeFileSync(probe, "ok", "utf-8");
    fs.rmSync(probe, { force: true });
    return { id: "data-dir", status: "pass", summary: `writable data dir: ${dirPath}` };
  } catch {
    return {
      id: "data-dir",
      status: "fail",
      summary: `data dir not writable: ${dirPath}`,
      fix: "Set ORBIT_DATA_DIR to a writable path."
    };
  }
}

function checkApiToken(config: OrbitConfig): StarCheck {
  if (config.api.authToken) return { id: "api-token", status: "pass", summary: "API token configured" };
  return {
    id: "api-token",
    status: "warn",
    summary: "API token not configured",
    fix: "Set ORBIT_API_TOKEN for authenticated API usage."
  };
}

function canConnectPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(700, () => finish(false));
  });
}

async function checkApiPortReachability(): Promise<StarCheck> {
  const reachable = await canConnectPort(8787, "127.0.0.1");
  if (reachable) return { id: "api-port", status: "pass", summary: "API reachable on 127.0.0.1:8787" };
  return {
    id: "api-port",
    status: "warn",
    summary: "API not reachable on 127.0.0.1:8787",
    fix: "Run `orbit api --host 127.0.0.1 --port 8787` if you need the HTTP API."
  };
}

export async function runStarDoctor(config: OrbitConfig): Promise<StarDoctorReport> {
  const checks: StarCheck[] = [];
  checks.push(checkNodeRuntime());
  checks.push(checkDirWritable(config.dataDir));
  checks.push(checkDocker());
  checks.push(checkApiToken(config));
  checks.push(await checkNatsConnectivity(config.natsUrl));
  checks.push(await checkApiPortReachability());
  return {
    module: "Star",
    ok: checks.every((check) => check.status !== "fail"),
    checkedAt: new Date().toISOString(),
    checks
  };
}
