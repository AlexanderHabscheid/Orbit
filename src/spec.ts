import { ServiceSpec } from "./types.js";
import { OrbitError } from "./errors.js";
import { readJsonFile } from "./util.js";

export function loadServiceSpec(specPath: string): ServiceSpec {
  const spec = readJsonFile<ServiceSpec>(specPath);
  if (!spec || typeof spec !== "object" || !spec.methods || typeof spec.methods !== "object") {
    throw new OrbitError("INVALID_SPEC", "spec must include methods object");
  }
  if (typeof spec.version === "string" && spec.version.trim().length === 0) {
    throw new OrbitError("INVALID_SPEC", "spec version cannot be empty");
  }
  for (const [method, conf] of Object.entries(spec.methods)) {
    const transport = conf.transport ?? "worker";
    if (conf.request_schema !== undefined && (!conf.request_schema || typeof conf.request_schema !== "object" || Array.isArray(conf.request_schema))) {
      throw new OrbitError("INVALID_SPEC", `method ${method} request_schema must be an object`);
    }
    if (conf.response_schema !== undefined && (!conf.response_schema || typeof conf.response_schema !== "object" || Array.isArray(conf.response_schema))) {
      throw new OrbitError("INVALID_SPEC", `method ${method} response_schema must be an object`);
    }
    if (transport === "http") {
      if (!conf.http_endpoint || typeof conf.http_endpoint !== "string") {
        throw new OrbitError("INVALID_SPEC", `method ${method} missing http_endpoint for http transport`);
      }
      continue;
    }
    if (!conf.command || typeof conf.command !== "string") {
      throw new OrbitError("INVALID_SPEC", `method ${method} missing command`);
    }
  }
  return spec;
}
