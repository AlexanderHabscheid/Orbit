import crypto from "node:crypto";
import { connectEchoClient, EchoClient } from "../echo/client.js";
import { Logger } from "../logger.js";
import { closeBus, connectBus, decodeJson, encodeJson } from "../nats.js";
import { OrbitConfig } from "../types.js";
import { CellRoute } from "./routing.js";

interface GatewayOptions {
  socketPath?: string;
  host?: string;
  port?: number;
  cellId: string;
  routes: CellRoute[];
  fromLatest?: boolean;
}

interface BridgeEnvelope {
  channel: string;
  payload: unknown;
  meta?: {
    cell_id?: string;
    ts?: string;
  };
}

interface HashEntry {
  hash: string;
  expiresAt: number;
}

class RecentHashCache {
  private readonly entries: HashEntry[] = [];

  has(hash: string): boolean {
    this.prune();
    return this.entries.some((entry) => entry.hash === hash);
  }

  add(hash: string, ttlMs: number): void {
    this.prune();
    this.entries.push({ hash, expiresAt: Date.now() + ttlMs });
    if (this.entries.length > 4096) this.entries.splice(0, this.entries.length - 4096);
  }

  private prune(): void {
    const now = Date.now();
    while (this.entries.length > 0 && this.entries[0].expiresAt <= now) {
      this.entries.shift();
    }
  }
}

class EchoPublisher {
  private readonly pending: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
  private closed = false;

  constructor(private readonly client: EchoClient) {
    this.client.onLine((line) => {
      const wait = this.pending.shift();
      if (!wait) return;
      try {
        const msg = JSON.parse(line) as { ok?: boolean; error?: string };
        if (msg.ok) wait.resolve();
        else wait.reject(new Error(msg.error ?? "echo publish failed"));
      } catch (err) {
        wait.reject(err as Error);
      }
    });
  }

  publish(channel: string, payloadBase64: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("echo publisher closed"));
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.client.send({ type: "publish", channel, payloadBase64 });
    });
  }

  close(): void {
    this.closed = true;
    this.client.close();
    while (this.pending.length > 0) {
      const wait = this.pending.shift();
      wait?.reject(new Error("echo publisher closed"));
    }
  }
}

function sha256Base64(payloadBase64: string): string {
  return crypto.createHash("sha256").update(payloadBase64).digest("hex");
}

export async function runCellGateway(config: OrbitConfig, logger: Logger, opts: GatewayOptions): Promise<void> {
  const endpoint = {
    socketPath: opts.socketPath,
    host: opts.host,
    port: opts.port
  };

  const nc = await connectBus(config.natsUrl);
  const ingressPublisher = new EchoPublisher(await connectEchoClient(endpoint));
  const localSubs: EchoClient[] = [];
  const recentIngress = new RecentHashCache();

  const stopLocalLoops: Array<() => void> = [];
  const stopNetworkLoops: Array<() => void> = [];

  for (const route of opts.routes) {
    if (route.localToNetwork) {
      const client = await connectEchoClient(endpoint);
      client.onLine((line) => {
        const msg = JSON.parse(line) as { ok?: boolean; type?: string; payloadBase64?: string };
        if (!msg.ok || msg.type !== "event" || !msg.payloadBase64) return;
        const hash = sha256Base64(msg.payloadBase64);
        if (recentIngress.has(hash)) return;

        const payloadText = Buffer.from(msg.payloadBase64, "base64").toString("utf-8");
        let payload: unknown;
        try {
          payload = JSON.parse(payloadText);
        } catch {
          payload = { raw_base64: msg.payloadBase64 };
        }

        const envelope: BridgeEnvelope = {
          channel: route.channel,
          payload,
          meta: { cell_id: opts.cellId, ts: new Date().toISOString() }
        };
        nc.publish(route.subject, encodeJson(envelope));
      });
      client.send({ type: "subscribe", channel: route.channel, fromLatest: opts.fromLatest ?? true });
      localSubs.push(client);
      stopLocalLoops.push(() => client.close());
    }

    if (route.networkToLocal) {
      const sub = nc.subscribe(route.subject);
      const stop = { active: true };
      stopNetworkLoops.push(() => {
        stop.active = false;
        sub.unsubscribe();
      });

      void (async () => {
        for await (const msg of sub) {
          if (!stop.active) break;

          let envelope: BridgeEnvelope;
          try {
            envelope = decodeJson(msg.data) as BridgeEnvelope;
          } catch {
            continue;
          }
          if (envelope.meta?.cell_id === opts.cellId) continue;

          const payload = "payload" in envelope ? envelope.payload : envelope;
          const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64");
          recentIngress.add(sha256Base64(payloadBase64), 5000);
          try {
            await ingressPublisher.publish(route.channel, payloadBase64);
          } catch (err) {
            logger.warn("cell ingress publish failed", {
              channel: route.channel,
              subject: route.subject,
              err: (err as Error).message
            });
          }
        }
      })().catch((err) => {
        logger.error("network->local loop crashed", {
          channel: route.channel,
          subject: route.subject,
          err: (err as Error).message
        });
      });
    }
  }

  logger.info("cell gateway online", {
    cell_id: opts.cellId,
    routes: opts.routes.map((route) => ({
      channel: route.channel,
      mode: route.mode,
      subject: route.subject
    }))
  });

  const shutdown = async (): Promise<void> => {
    stopLocalLoops.forEach((fn) => fn());
    stopNetworkLoops.forEach((fn) => fn());
    localSubs.forEach((client) => client.close());
    ingressPublisher.close();
    await closeBus(config.natsUrl);
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });

  await nc.closed();
}
