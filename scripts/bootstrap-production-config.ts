import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

interface OrbitProductionConfig {
  api: {
    authToken: string;
    allowedHosts: string[];
    tls: {
      enabled: true;
      certFile: string;
      keyFile: string;
      caFile: string;
      requestClientCert: true;
      requireClientCert: true;
    };
  };
  runtime: {
    apiMaxConcurrent: number;
    apiMaxBodyBytes: number;
    apiRequestTimeoutMs: number;
    callRateLimitPerSec: number;
    circuitBreakerFailureThreshold: number;
    circuitBreakerCooldownMs: number;
    circuitBreakerHalfOpenMax: number;
  };
}

const cwd = process.cwd();
const outDir = path.join(cwd, ".orbit");
const outPath = path.join(outDir, "config.production.json");
const token = crypto.randomBytes(24).toString("base64url");

const config: OrbitProductionConfig = {
  api: {
    authToken: token,
    allowedHosts: ["127.0.0.1", "localhost", "::1"],
    tls: {
      enabled: true,
      certFile: "~/.orbit/tls/server.crt",
      keyFile: "~/.orbit/tls/server.key",
      caFile: "~/.orbit/tls/ca.crt",
      requestClientCert: true,
      requireClientCert: true
    }
  },
  runtime: {
    apiMaxConcurrent: 128,
    apiMaxBodyBytes: 524288,
    apiRequestTimeoutMs: 15000,
    callRateLimitPerSec: 50,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerCooldownMs: 10000,
    circuitBreakerHalfOpenMax: 1
  }
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      wrote: outPath,
      next: [
        "Generate and install TLS certs at ~/.orbit/tls",
        "Merge this file into ./.orbit/config.json or ~/.orbit/config.json",
        "Start API with orbit api --host 127.0.0.1 --port 8787"
      ]
    },
    null,
    2
  )}\n`
);
