export interface CellRouteTemplateEntry {
  mode: "local_only" | "replicate" | "global_only";
  subject: string;
}

export type CellRoutesTemplate = Record<string, CellRouteTemplateEntry>;

export type CellProfile = "production" | "high_throughput";

function subject(subjectPrefix: string, tail: string): string {
  return `${subjectPrefix}.${tail}`;
}

export function buildCellRoutesTemplate(profile: CellProfile, subjectPrefix: string): CellRoutesTemplate {
  const cleanPrefix = (subjectPrefix || "orbit").trim();
  if (!cleanPrefix || cleanPrefix.includes(" ")) {
    throw new Error("invalid subject prefix");
  }

  if (profile === "high_throughput") {
    return {
      "agent.loop": { mode: "replicate", subject: subject(cleanPrefix, "cell.channels.agent.loop") },
      "agent.audit": { mode: "global_only", subject: subject(cleanPrefix, "cell.audit.events") },
      "agent.metrics": { mode: "global_only", subject: subject(cleanPrefix, "cell.metrics.events") },
      "agent.trace": { mode: "global_only", subject: subject(cleanPrefix, "cell.trace.events") },
      "agent.debug": { mode: "local_only", subject: subject(cleanPrefix, "cell.debug.events") }
    };
  }

  return {
    "agent.loop": { mode: "replicate", subject: subject(cleanPrefix, "cell.channels.agent.loop") },
    "agent.audit": { mode: "global_only", subject: subject(cleanPrefix, "cell.audit.events") },
    "agent.metrics": { mode: "global_only", subject: subject(cleanPrefix, "cell.metrics.events") },
    "agent.debug": { mode: "local_only", subject: subject(cleanPrefix, "cell.debug.events") }
  };
}
