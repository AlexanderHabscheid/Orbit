import { connect, JSONCodec, NatsConnection } from "nats";
import { OrbitError } from "./errors.js";

const jc = JSONCodec<unknown>();
const connectionCache = new Map<string, Promise<NatsConnection>>();
const kvViewCache = new WeakMap<NatsConnection, Map<string, any>>();
const osViewCache = new WeakMap<NatsConnection, Map<string, any>>();

export async function connectBus(url: string): Promise<NatsConnection> {
  const cached = connectionCache.get(url);
  if (cached) return cached;
  const pending = connect({ servers: url })
    .then((nc) => {
      const remove = () => {
        if (connectionCache.get(url) === pending) connectionCache.delete(url);
      };
      nc.closed().then(remove).catch(remove);
      return nc;
    })
    .catch((err) => {
      if (connectionCache.get(url) === pending) connectionCache.delete(url);
      throw err;
    });
  connectionCache.set(url, pending);
  return pending;
}

export async function closeBus(url: string): Promise<void> {
  const pending = connectionCache.get(url);
  if (!pending) return;
  connectionCache.delete(url);
  const nc = await pending;
  await nc.drain();
}

export function encodeJson(value: unknown): Uint8Array {
  return jc.encode(value);
}

export function decodeJson(value: Uint8Array): unknown {
  return jc.decode(value);
}

async function kvView(nc: NatsConnection, bucket: string): Promise<any> {
  const js: any = nc.jetstream();
  let perConn = kvViewCache.get(nc);
  if (!perConn) {
    perConn = new Map<string, any>();
    kvViewCache.set(nc, perConn);
  }
  let kv = perConn.get(bucket);
  if (!kv) {
    kv = await js.views.kv(bucket, { history: 1 });
    perConn.set(bucket, kv);
  }
  return kv;
}

async function osView(nc: NatsConnection, bucket: string): Promise<any> {
  const js: any = nc.jetstream();
  let perConn = osViewCache.get(nc);
  if (!perConn) {
    perConn = new Map<string, any>();
    osViewCache.set(nc, perConn);
  }
  let os = perConn.get(bucket);
  if (!os) {
    os = await js.views.os(bucket);
    perConn.set(bucket, os);
  }
  return os;
}

export async function kvPut(
  nc: NatsConnection,
  bucket: string,
  key: string,
  value: unknown
): Promise<void> {
  const kv = await kvView(nc, bucket);
  await kv.put(key, encodeJson(value));
}

export async function kvGet<T>(nc: NatsConnection, bucket: string, key: string): Promise<T | null> {
  const kv = await kvView(nc, bucket);
  const entry = await kv.get(key);
  if (!entry) return null;
  return decodeJson(entry.value) as T;
}

export async function osPut(
  nc: NatsConnection,
  bucket: string,
  key: string,
  body: Uint8Array,
  options?: { description?: string; headers?: Record<string, string> }
): Promise<void> {
  const os = await osView(nc, bucket);
  try {
    await os.put({
      name: key,
      data: body,
      description: options?.description,
      headers: options?.headers
    });
    return;
  } catch {
    // Fallback signature for client variants.
  }
  try {
    await os.put(key, body, options);
    return;
  } catch {
    // final fallback
  }
  await os.put({ name: key }, body);
}

export async function publishSubject(
  nc: NatsConnection,
  subject: string,
  payload: Uint8Array,
  options?: { durable?: boolean; dedupeKey?: string; timeoutMs?: number }
): Promise<void> {
  if (!options?.durable) {
    nc.publish(subject, payload);
    return;
  }
  const js: any = nc.jetstream();
  const publishPromise = js.publish(
    subject,
    payload,
    options.dedupeKey ? { msgID: options.dedupeKey } : undefined
  );
  if (!options.timeoutMs || options.timeoutMs <= 0) {
    await publishPromise;
    return;
  }
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new OrbitError(
          "PUBLISH_TIMEOUT",
          `durable publish ack timed out after ${options.timeoutMs}ms for subject ${subject}`
        )
      );
    }, options.timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([publishPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
