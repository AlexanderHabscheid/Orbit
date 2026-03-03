import { USER_CONFIG_PATH, readUserConfigRaw, writeUserConfigRaw } from "../config.js";
import { OrbitError } from "../errors.js";
import { Logger } from "../logger.js";
import { OrbitConfig, OrbitContext } from "../types.js";

type ContextRaw = Record<string, OrbitContext>;

function readContexts(config: OrbitConfig): { active: string; contexts: ContextRaw } {
  const raw = readUserConfigRaw();
  const contexts = (raw.contexts as ContextRaw | undefined) ?? {
    default: {
      natsUrl: config.natsUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      retries: config.retries
    }
  };
  const active = (raw.activeContext as string | undefined) ?? config.activeContext ?? "default";
  return { active, contexts };
}

export function cmdContext(
  config: OrbitConfig,
  _logger: Logger,
  opts: {
    subcommand?: string;
    name?: string;
    natsUrl?: string;
    timeoutMs?: number;
    retries?: number;
  }
): void {
  const { active, contexts } = readContexts(config);
  const sub = opts.subcommand ?? "current";

  if (sub === "list") {
    process.stdout.write(
      `${JSON.stringify(
        {
          active,
          config_file: USER_CONFIG_PATH,
          contexts
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (sub === "current") {
    process.stdout.write(
      `${JSON.stringify(
        {
          active,
          value: contexts[active]
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (sub === "use") {
    if (!opts.name) throw new OrbitError("BAD_ARGS", "context use requires context name");
    if (!contexts[opts.name]) throw new OrbitError("BAD_ARGS", `context ${opts.name} does not exist`);
    const raw = readUserConfigRaw();
    writeUserConfigRaw({
      ...raw,
      activeContext: opts.name,
      contexts
    });
    process.stdout.write(`${JSON.stringify({ ok: true, activeContext: opts.name }, null, 2)}\n`);
    return;
  }

  if (sub === "set") {
    if (!opts.name) throw new OrbitError("BAD_ARGS", "context set requires context name");
    const base = contexts[opts.name] ?? contexts[active] ?? {
      natsUrl: config.natsUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      retries: config.retries
    };
    const next: OrbitContext = {
      natsUrl: opts.natsUrl ?? base.natsUrl,
      requestTimeoutMs: opts.timeoutMs ?? base.requestTimeoutMs,
      retries: opts.retries ?? base.retries
    };
    const updated = { ...contexts, [opts.name]: next };
    const raw = readUserConfigRaw();
    writeUserConfigRaw({
      ...raw,
      activeContext: raw.activeContext ?? active,
      contexts: updated
    });
    process.stdout.write(`${JSON.stringify({ ok: true, name: opts.name, value: next }, null, 2)}\n`);
    return;
  }

  throw new OrbitError("BAD_ARGS", `unknown context subcommand: ${sub}`);
}

