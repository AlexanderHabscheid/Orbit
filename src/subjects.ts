import { OrbitConfig } from "./types.js";

export function prefixedSubject(config: OrbitConfig, ...parts: string[]): string {
  const clean = parts.map((p) => p.replace(/^\.+|\.+$/g, "")).filter(Boolean);
  return [config.routing.subjectPrefix, ...clean].join(".");
}

