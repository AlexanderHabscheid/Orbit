import path from "node:path";
import fs from "node:fs";
import { OrbitConfig, ServiceSpec } from "./types.js";
import { writeJsonFile } from "./util.js";
import { closeBus, connectBus, kvGet, kvPut } from "./nats.js";

export interface ServiceRegistryRecord {
  service: string;
  registered_at: string;
  spec: ServiceSpec;
}

export function saveServiceRecord(config: OrbitConfig, service: string, spec: ServiceSpec): void {
  const rec: ServiceRegistryRecord = {
    service,
    registered_at: new Date().toISOString(),
    spec
  };
  const filePath = path.join(config.servicesDir, `${service}.json`);
  writeJsonFile(filePath, rec);
}

export async function saveServiceRecordDistributed(config: OrbitConfig, service: string, spec: ServiceSpec): Promise<void> {
  saveServiceRecord(config, service, spec);
  try {
    const nc = await connectBus(config.natsUrl);
    const rec: ServiceRegistryRecord = {
      service,
      registered_at: new Date().toISOString(),
      spec
    };
    try {
      await kvPut(nc, config.kvBucket, service, rec);
    } finally {
      await closeBus(config.natsUrl);
    }
  } catch {
    // local file registry remains authoritative fallback when JetStream/KV is unavailable.
  }
}

export function loadServiceRecord(config: OrbitConfig, service: string): ServiceRegistryRecord | null {
  const filePath = path.join(config.servicesDir, `${service}.json`);
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(text) as ServiceRegistryRecord;
}

export async function loadServiceRecordDistributed(
  config: OrbitConfig,
  service: string
): Promise<ServiceRegistryRecord | null> {
  try {
    const nc = await connectBus(config.natsUrl);
    try {
      const rec = await kvGet<ServiceRegistryRecord>(nc, config.kvBucket, service);
      if (rec) return rec;
    } finally {
      await closeBus(config.natsUrl);
    }
  } catch {
    // no-op fallback to local registry below
  }
  return loadServiceRecord(config, service);
}
