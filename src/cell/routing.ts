import fs from "node:fs";
import { OrbitConfig } from "../types.js";

export type CellRouteMode = "local_only" | "replicate" | "global_only";

interface RawRoute {
  mode?: CellRouteMode;
  subject?: string;
}

export interface CellRoute {
  channel: string;
  mode: CellRouteMode;
  subject: string;
  localToNetwork: boolean;
  networkToLocal: boolean;
}

export interface CellRoutingPlan {
  routes: CellRoute[];
  source?: string;
}

function defaultSubject(config: OrbitConfig, channel: string): string {
  return `${config.routing.subjectPrefix}.cell.channels.${channel}`;
}

function isValidChannel(channel: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(channel);
}

function parseMode(value: unknown): CellRouteMode | undefined {
  if (value === "local_only" || value === "replicate" || value === "global_only") return value;
  return undefined;
}

function toRoute(config: OrbitConfig, channel: string, mode: CellRouteMode, subject?: string): CellRoute {
  if (!isValidChannel(channel)) {
    throw new Error(`invalid channel '${channel}': use [A-Za-z0-9._-]`);
  }
  const outSubject = (subject ?? defaultSubject(config, channel)).trim();
  if (!outSubject || outSubject.includes(" ")) {
    throw new Error(`invalid subject for channel '${channel}'`);
  }

  return {
    channel,
    mode,
    subject: outSubject,
    localToNetwork: mode === "replicate" || mode === "global_only",
    networkToLocal: mode === "replicate"
  };
}

export function resolveCellRoutingPlan(
  config: OrbitConfig,
  opts: { routesFile?: string; channels?: string[]; defaultMode?: CellRouteMode }
): CellRoutingPlan {
  const defaultMode = opts.defaultMode ?? "replicate";

  if (opts.routesFile) {
    const raw = JSON.parse(fs.readFileSync(opts.routesFile, "utf-8")) as Record<string, string | RawRoute>;
    const routes = Object.entries(raw).map(([channel, value]) => {
      if (typeof value === "string") {
        const mode = parseMode(value);
        if (!mode) throw new Error(`invalid mode '${value}' for channel '${channel}'`);
        return toRoute(config, channel, mode);
      }
      const mode = parseMode(value?.mode) ?? defaultMode;
      return toRoute(config, channel, mode, value?.subject);
    });
    return { routes, source: opts.routesFile };
  }

  const channels = opts.channels && opts.channels.length > 0 ? opts.channels : ["agent.loop"];
  const routes = channels.map((channel) => toRoute(config, channel, defaultMode));
  return { routes };
}
