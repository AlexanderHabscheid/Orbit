import { loadConfig } from "./config.js";
import { OrbitError } from "./errors.js";
import { Logger } from "./logger.js";
import { cmdCall } from "./commands/call.js";
import { cmdInspect } from "./commands/inspect.js";
import { cmdPublish } from "./commands/publish.js";
import { cmdServe } from "./commands/serve.js";
import { cmdSubscribe } from "./commands/subscribe.js";
import { cmdTrace } from "./commands/trace.js";
import { cmdUp } from "./commands/up.js";
import { cmdContext } from "./commands/context.js";
import { cmdBench } from "./commands/bench.js";
import { cmdMonitor } from "./commands/monitor.js";
import { cmdAgent } from "./commands/agent.js";
import { cmdApi } from "./commands/api.js";
import { cmdBenchOverhead } from "./commands/bench_overhead.js";
import { cmdCell } from "./commands/cell.js";
import { cmdDlqReplay } from "./commands/dlq_replay.js";
import { cmdDlqInspect } from "./commands/dlq_inspect.js";
import { cmdDlqPurge } from "./commands/dlq_purge.js";
import { runEchoCli } from "./echo/cli.js";
import { argValue, hasFlag, parseJsonInput } from "./util.js";

function usage(): string {
  return `orbit - local agent message bus

Usage:
  orbit up
  orbit serve --name <svc> --spec <spec.json> [--queue <group>] [--concurrency 8]
  orbit call <svc>.<method> --json @req.json [--pack-file ./blob.bin] [--timeout-ms 5000] [--retries 2]
  orbit publish <topic> --json @event.json [--pack-file ./blob.bin] [--durable] [--dedupe-key <id>]
  orbit subscribe <topic> [--durable-name <name>] [--stream <name>] [--dlq-topic <topic>] [--ack-wait-ms 30000] [--max-deliver 5] [--require-json]
  orbit dlq-inspect <dlq-topic> [--stream <name>] [--limit 100] [--from-ts <iso>] [--to-ts <iso>] [--error-code <code>] [--source-consumer <name>]
  orbit dlq-purge <dlq-topic> [--stream <name>] [--limit 100] [--from-ts <iso>] [--to-ts <iso>] [--error-code <code>] [--source-consumer <name>] [--dry-run]
  orbit dlq-replay <dlq-topic> --to-topic <topic> [--limit 100] [--stream <name>] [--from-ts <iso>] [--to-ts <iso>] [--error-code <code>] [--source-consumer <name>] [--purge-replayed] [--non-durable-publish]
  orbit inspect <svc>
  orbit trace <run-id>
  orbit context [list|current|use <name>|set <name> --nats-url <url> --timeout-ms <n> --retries <n>]
  orbit bench <svc>.<method> --json @req.json [--duration-s 15] [--concurrency 10] [--ramp-to 50] [--ramp-step-s 1] [--ramp-step-concurrency 2] [--timeout-ms 2000] [--retries 0]
  orbit bench-overhead <svc>.<method> --json @req.json [--iterations 100] [--timeout-ms 2000]
  orbit monitor [--service <svc>] [--interval-ms 2000] [--timeout-ms 1500] [--alerts] [--alert-latency-ms 250] [--alert-error-rate 0.05] [--alert-consecutive 3] [--alert-cooldown-s 30] [--once]
  orbit agent
  orbit api [--host 127.0.0.1] [--port 8787]
  orbit cell <init|start|gateway|status> [...]
  orbit echo <start|publish|subscribe|stats|bench> [...]
`;
}

export async function run(argv: string[], cwd: string): Promise<void> {
  if (argv.length === 0 || ((hasFlag(argv, "--help") || hasFlag(argv, "-h")) && !["echo", "cell"].includes(argv[0]))) {
    process.stdout.write(usage());
    return;
  }

  const [command, ...rest] = argv;
  if (command === "echo") {
    await runEchoCli(rest);
    return;
  }

  const config = loadConfig(cwd);
  const logger = new Logger(hasFlag(argv, "--verbose") ? "debug" : config.logLevel);

  switch (command) {
    case "up": {
      await cmdUp(config, logger);
      return;
    }
    case "serve": {
      const name = argValue(rest, "--name");
      const specPath = argValue(rest, "--spec");
      if (!name || !specPath) throw new OrbitError("BAD_ARGS", "serve requires --name and --spec");
      const queueGroup = argValue(rest, "--queue");
      const concurrency = Number(argValue(rest, "--concurrency") ?? "1");
      if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 1024) {
        throw new OrbitError("BAD_ARGS", "--concurrency must be an integer between 1 and 1024");
      }
      await cmdServe(config, logger, { name, specPath, queueGroup, concurrency });
      return;
    }
    case "call": {
      const target = rest[0];
      const jsonArg = argValue(rest, "--json");
      if (!target || !jsonArg) throw new OrbitError("BAD_ARGS", "call requires target and --json");
      const body = parseJsonInput(jsonArg);
      const timeoutMs = Number(argValue(rest, "--timeout-ms") ?? config.requestTimeoutMs);
      const retries = Number(argValue(rest, "--retries") ?? config.retries);
      const runId = argValue(rest, "--run-id");
      const packFile = argValue(rest, "--pack-file");
      await cmdCall(config, logger, { target, body, timeoutMs, retries, runId, packFile });
      return;
    }
    case "publish": {
      const topic = rest[0];
      const jsonArg = argValue(rest, "--json");
      if (!topic || !jsonArg) throw new OrbitError("BAD_ARGS", "publish requires topic and --json");
      await cmdPublish(config, logger, {
        topic,
        body: parseJsonInput(jsonArg),
        runId: argValue(rest, "--run-id"),
        packFile: argValue(rest, "--pack-file"),
        durable: hasFlag(rest, "--durable") ? true : undefined,
        dedupeKey: argValue(rest, "--dedupe-key")
      });
      return;
    }
    case "subscribe": {
      const topic = rest[0];
      if (!topic) throw new OrbitError("BAD_ARGS", "subscribe requires topic");
      await cmdSubscribe(config, logger, {
        topic,
        durableName: argValue(rest, "--durable-name"),
        streamName: argValue(rest, "--stream"),
        dlqTopic: argValue(rest, "--dlq-topic"),
        ackWaitMs: argValue(rest, "--ack-wait-ms") ? Number(argValue(rest, "--ack-wait-ms")) : undefined,
        maxDeliver: argValue(rest, "--max-deliver") ? Number(argValue(rest, "--max-deliver")) : undefined,
        requireJson: hasFlag(rest, "--require-json")
      });
      return;
    }
    case "dlq-replay": {
      const dlqTopic = rest[0];
      const targetTopic = argValue(rest, "--to-topic");
      if (!dlqTopic || !targetTopic) throw new OrbitError("BAD_ARGS", "dlq-replay requires <dlq-topic> and --to-topic");
      await cmdDlqReplay(config, logger, {
        dlqTopic,
        targetTopic,
        limit: argValue(rest, "--limit") ? Number(argValue(rest, "--limit")) : undefined,
        streamName: argValue(rest, "--stream"),
        durablePublish: hasFlag(rest, "--non-durable-publish") ? false : undefined,
        purgeReplayed: hasFlag(rest, "--purge-replayed"),
        fromTs: argValue(rest, "--from-ts"),
        toTs: argValue(rest, "--to-ts"),
        errorCode: argValue(rest, "--error-code"),
        sourceConsumer: argValue(rest, "--source-consumer")
      });
      return;
    }
    case "dlq-inspect": {
      const dlqTopic = rest[0];
      if (!dlqTopic) throw new OrbitError("BAD_ARGS", "dlq-inspect requires <dlq-topic>");
      await cmdDlqInspect(config, logger, {
        dlqTopic,
        streamName: argValue(rest, "--stream"),
        limit: argValue(rest, "--limit") ? Number(argValue(rest, "--limit")) : undefined,
        fromTs: argValue(rest, "--from-ts"),
        toTs: argValue(rest, "--to-ts"),
        errorCode: argValue(rest, "--error-code"),
        sourceConsumer: argValue(rest, "--source-consumer")
      });
      return;
    }
    case "dlq-purge": {
      const dlqTopic = rest[0];
      if (!dlqTopic) throw new OrbitError("BAD_ARGS", "dlq-purge requires <dlq-topic>");
      await cmdDlqPurge(config, logger, {
        dlqTopic,
        streamName: argValue(rest, "--stream"),
        limit: argValue(rest, "--limit") ? Number(argValue(rest, "--limit")) : undefined,
        dryRun: hasFlag(rest, "--dry-run"),
        fromTs: argValue(rest, "--from-ts"),
        toTs: argValue(rest, "--to-ts"),
        errorCode: argValue(rest, "--error-code"),
        sourceConsumer: argValue(rest, "--source-consumer")
      });
      return;
    }
    case "inspect": {
      const service = rest[0];
      if (!service) throw new OrbitError("BAD_ARGS", "inspect requires service name");
      await cmdInspect(config, logger, { service, timeoutMs: Number(argValue(rest, "--timeout-ms") ?? config.requestTimeoutMs) });
      return;
    }
    case "trace": {
      const runId = rest[0];
      if (!runId) throw new OrbitError("BAD_ARGS", "trace requires run-id");
      cmdTrace(config, logger, { runId });
      return;
    }
    case "context": {
      const subcommand = rest[0];
      const name = subcommand === "set" || subcommand === "use" ? rest[1] : undefined;
      cmdContext(config, logger, {
        subcommand,
        name,
        natsUrl: argValue(rest, "--nats-url"),
        timeoutMs: argValue(rest, "--timeout-ms") ? Number(argValue(rest, "--timeout-ms")) : undefined,
        retries: argValue(rest, "--retries") ? Number(argValue(rest, "--retries")) : undefined
      });
      return;
    }
    case "bench": {
      const target = rest[0];
      const jsonArg = argValue(rest, "--json");
      if (!target || !jsonArg) throw new OrbitError("BAD_ARGS", "bench requires target and --json");
      const durationSec = Number(argValue(rest, "--duration-s") ?? "15");
      const concurrency = Number(argValue(rest, "--concurrency") ?? "10");
      const rampToConcurrency = argValue(rest, "--ramp-to") ? Number(argValue(rest, "--ramp-to")) : undefined;
      const rampStepSec = argValue(rest, "--ramp-step-s") ? Number(argValue(rest, "--ramp-step-s")) : undefined;
      const rampStepConcurrency = argValue(rest, "--ramp-step-concurrency")
        ? Number(argValue(rest, "--ramp-step-concurrency"))
        : undefined;
      if (!Number.isFinite(durationSec) || durationSec <= 0) throw new OrbitError("BAD_ARGS", "--duration-s must be > 0");
      if (!Number.isFinite(concurrency) || concurrency <= 0) throw new OrbitError("BAD_ARGS", "--concurrency must be > 0");
      if (rampToConcurrency !== undefined && (!Number.isFinite(rampToConcurrency) || rampToConcurrency <= 0)) {
        throw new OrbitError("BAD_ARGS", "--ramp-to must be > 0");
      }
      if (rampStepSec !== undefined && (!Number.isFinite(rampStepSec) || rampStepSec <= 0)) {
        throw new OrbitError("BAD_ARGS", "--ramp-step-s must be > 0");
      }
      if (rampStepConcurrency !== undefined && (!Number.isFinite(rampStepConcurrency) || rampStepConcurrency <= 0)) {
        throw new OrbitError("BAD_ARGS", "--ramp-step-concurrency must be > 0");
      }
      await cmdBench(config, logger, {
        target,
        body: parseJsonInput(jsonArg),
        durationSec,
        concurrency,
        rampToConcurrency,
        rampStepSec,
        rampStepConcurrency,
        timeoutMs: Number(argValue(rest, "--timeout-ms") ?? config.requestTimeoutMs),
        retries: Number(argValue(rest, "--retries") ?? "0")
      });
      return;
    }
    case "monitor": {
      const intervalMs = Number(argValue(rest, "--interval-ms") ?? "2000");
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new OrbitError("BAD_ARGS", "--interval-ms must be > 0");
      const alertLatencyMs = argValue(rest, "--alert-latency-ms")
        ? Number(argValue(rest, "--alert-latency-ms"))
        : undefined;
      const alertErrorRate = argValue(rest, "--alert-error-rate") ? Number(argValue(rest, "--alert-error-rate")) : undefined;
      const alertConsecutive = argValue(rest, "--alert-consecutive")
        ? Number(argValue(rest, "--alert-consecutive"))
        : undefined;
      const alertCooldownSec = argValue(rest, "--alert-cooldown-s") ? Number(argValue(rest, "--alert-cooldown-s")) : undefined;
      if (alertLatencyMs !== undefined && (!Number.isFinite(alertLatencyMs) || alertLatencyMs < 0)) {
        throw new OrbitError("BAD_ARGS", "--alert-latency-ms must be >= 0");
      }
      if (alertErrorRate !== undefined && (!Number.isFinite(alertErrorRate) || alertErrorRate < 0 || alertErrorRate > 1)) {
        throw new OrbitError("BAD_ARGS", "--alert-error-rate must be between 0 and 1");
      }
      if (alertConsecutive !== undefined && (!Number.isInteger(alertConsecutive) || alertConsecutive < 1)) {
        throw new OrbitError("BAD_ARGS", "--alert-consecutive must be an integer >= 1");
      }
      if (alertCooldownSec !== undefined && (!Number.isFinite(alertCooldownSec) || alertCooldownSec < 0)) {
        throw new OrbitError("BAD_ARGS", "--alert-cooldown-s must be >= 0");
      }
      await cmdMonitor(config, logger, {
        service: argValue(rest, "--service"),
        intervalMs,
        timeoutMs: Number(argValue(rest, "--timeout-ms") ?? config.requestTimeoutMs),
        alerts: hasFlag(rest, "--alerts"),
        alertDown: hasFlag(rest, "--alert-no-down") ? false : undefined,
        alertLatencyMs,
        alertErrorRate,
        alertConsecutive,
        alertCooldownSec,
        once: hasFlag(rest, "--once")
      });
      return;
    }
    case "bench-overhead": {
      const target = rest[0];
      const jsonArg = argValue(rest, "--json");
      if (!target || !jsonArg) throw new OrbitError("BAD_ARGS", "bench-overhead requires target and --json");
      await cmdBenchOverhead(config, logger, {
        target,
        body: parseJsonInput(jsonArg),
        iterations: Number(argValue(rest, "--iterations") ?? "100"),
        timeoutMs: Number(argValue(rest, "--timeout-ms") ?? config.requestTimeoutMs)
      });
      return;
    }
    case "agent": {
      await cmdAgent(config, logger);
      return;
    }
    case "api": {
      const host = argValue(rest, "--host") ?? "127.0.0.1";
      const port = Number(argValue(rest, "--port") ?? "8787");
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new OrbitError("BAD_ARGS", "--port must be an integer between 1 and 65535");
      }
      await cmdApi(config, logger, { host, port });
      return;
    }
    case "cell": {
      await cmdCell(config, logger, rest);
      return;
    }
    default:
      throw new OrbitError("UNKNOWN_COMMAND", `unknown command: ${command}`);
  }
}
