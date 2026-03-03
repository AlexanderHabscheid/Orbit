# ORBIT

ORBIT is a local-first agent message bus CLI built on NATS with:

- Request/reply RPC (`orbit call`, `orbit serve`)
- Pub/sub (`orbit publish`, `orbit subscribe`)
- Service discovery + capability inspection (`orbit inspect`)
- Trace timelines with retries/timeouts (`orbit trace`)
- Canonical typed envelopes with integrity hash
- NATS Service API compatibility (`$SRV.PING|INFO|STATS`)
- JetStream KV service registry + Object Store data packs
- Context switching (`orbit context ...`)
- Optional OpenTelemetry OTLP export
- Benchmarking command (`orbit bench`)
- Orbit overhead benchmark (`orbit bench-overhead`)
- Live health/stat monitor (`orbit monitor`)
- Local persistent control-plane agent (`orbit agent`)
- External Orbit API service (`orbit api`)
- Externalized HTTP and persistent-worker method transports

## Install

```bash
npm install
npm run build
npm link
```

## Commands

```bash
orbit up
orbit serve --name <svc> --spec spec.json [--queue workers] [--concurrency 8]
orbit call <svc>.<method> --json @req.json [--run-id <id>] [--pack-file ./blob.bin] [--timeout-ms 5000] [--retries 2]
orbit publish <topic> --json @event.json [--run-id <id>] [--pack-file ./blob.bin] [--durable] [--dedupe-key <id>]
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
echocore start [--socket /tmp/echocore.sock] [--tcp-port 7777]
echocore publish --channel agent.loop --json @event.json
echocore subscribe --channel agent.loop
echocore bench [--messages 50000] [--bytes 1024]
```

## EchoCore

`echocore` is a local event-stream module optimized for desktop-agent component wiring:

- Shared-memory ring buffers per channel (in-process, zero-copy subscriber views)
- Backpressure policies (`drop_oldest` or `drop_newest`)
- Channel isolation
- Local unix-socket daemon bridge with optional TCP fallback
- Built-in benchmark command (`echocore bench`) for in-process vs network-framed baseline

You can invoke EchoCore either directly (`echocore ...`) or through Orbit (`orbit echo ...`).

### Cell Mode

`orbit cell` lets you run a cloud-friendly two-tier topology from one CLI package:

- `orbit cell init`: scaffolds production routing template JSON.
- `orbit cell start`: starts local EchoCore daemon, optional embedded gateway.
- `orbit cell gateway`: bridges local channels to Orbit network subjects.
- `orbit cell status`: reports process state and local channel stats.

Routing modes (`--mode` or routes file):

- `local_only`: local channel only, no network bridge.
- `replicate`: bi-directional bridge between local channel and network subject.
- `global_only`: egress local->network only.

Examples:

```bash
orbit cell init --out ./examples/cell.routes.production.json
orbit cell start --gateway --routes @./examples/cell.routes.production.json
orbit cell start --gateway --channel agent.loop --mode replicate
orbit cell gateway --socket ~/.orbit/echocore.sock --channel agent.audit --mode global_only
orbit cell status
```

## Canonical Envelope

All bus messages use:

```json
{
  "id": "uuid",
  "run_id": "uuid",
  "ts": "2026-02-25T12:00:00.000Z",
  "kind": "request|response|event|capability|trace",
  "schema_version": "1.0",
  "payload": {},
  "data_pack": {"bucket":"orbit_datapacks","key":"run/key.bin"},
  "provenance": {},
  "cost": {},
  "a2a": {
    "task_id": "task-123",
    "thread_id": "thread-12",
    "parent_message_id": "msg-1",
    "capabilities": ["search", "retrieve"],
    "traceparent": "w3c-traceparent",
    "dedupe_key": "event-abc"
  },
  "hash": "sha256-of-canonical-fields"
}
```

## Quickstart

1. Start broker:

```bash
orbit up
```

2. Create a service spec (example at `examples/echo.spec.json`) and start adapter:

```bash
orbit serve --name text --spec examples/echo.spec.json
orbit serve --name text --spec examples/echo.spec.json --queue text-workers --concurrency 8
```

3. Call a method:

```bash
cat > req.json <<'JSON'
{"text":"hello orbit"}
JSON

orbit call text.upper --json @req.json
```

Call with a large binary data-pack attached:

```bash
orbit call text.upper --json @req.json --pack-file ./artifact.bin
```

4. Inspect service capabilities:

```bash
orbit inspect text
```

Also interoperates with NATS service introspection:

```bash
nats req '$SRV.INFO.text' '{}'
```

5. Publish/subscribe:

```bash
orbit subscribe agents.events
orbit publish agents.events --json '{"type":"build_done","ok":true}'

# Durable consumer + DLQ
orbit subscribe agents.events --durable-name agents-consumer --stream orbit_agents_stream --dlq-topic agents.events.dlq --max-deliver 5 --require-json

# Inspect only one consumer's overload failures in a window
orbit dlq-inspect agents.events.dlq --source-consumer agents-consumer --error-code AGENT_OVERLOADED --from-ts 2026-02-26T00:00:00Z --to-ts 2026-02-26T23:59:59Z

# Replay filtered DLQ messages back to primary topic and remove replayed entries
orbit dlq-replay agents.events.dlq --to-topic agents.events --error-code AGENT_OVERLOADED --source-consumer agents-consumer --limit 100 --purge-replayed

# Purge matching DLQ entries (preview first)
orbit dlq-purge agents.events.dlq --error-code AGENT_OVERLOADED --dry-run
orbit dlq-purge agents.events.dlq --error-code AGENT_OVERLOADED
```

6. View trace timeline:

```bash
orbit trace <run-id>
```

7. Run a load benchmark:

```bash
orbit bench text.upper --json @req.json --duration-s 20 --concurrency 16 --timeout-ms 1500 --retries 0
```

Run step-ramp benchmark profile:

```bash
orbit bench text.upper --json @req.json --duration-s 30 --concurrency 4 --ramp-to 20 --ramp-step-s 2 --ramp-step-concurrency 2
```

8. Monitor services live:

```bash
orbit monitor
orbit monitor --service text --interval-ms 1000
orbit monitor --service text --once
orbit monitor --service text --alerts --alert-latency-ms 200 --alert-error-rate 0.02
orbit monitor --service text --alerts --alert-consecutive 3 --alert-cooldown-s 45
```

9. Start external API service:

```bash
orbit api --host 127.0.0.1 --port 8787
```

If `ORBIT_API_TOKEN` (or `api.authToken`) is set, pass `Authorization: Bearer <token>` or `x-orbit-token`.
`GET /healthz` and `GET /readyz` are open; API action routes and `/metrics` require auth when token auth is enabled.

### Production Bootstrap

Generate a hardened API profile with token auth, TLS/mTLS enabled, and explicit runtime limits:

```bash
npm run bootstrap:prod
```

This writes `./.orbit/config.production.json`. Merge it into your active `./.orbit/config.json` (or `~/.orbit/config.json`),
install certs at `~/.orbit/tls`, then start `orbit api`.

## Service Spec Format

```json
{
  "version": "1.0.0",
  "description": "example service",
  "methods": {
    "methodName": {
      "description": "optional",
      "request_schema": {},
      "response_schema": {},
      "transport": "spawn|worker|http",
      "command": "python3",
      "args": ["script.py", "--x", "{{value}}"],
      "http_endpoint": "http://127.0.0.1:9000/echo",
      "http_method": "POST",
      "headers": {"x-tenant":"acme"},
      "timeout_ms": 5000
    }
  }
}
```

`{{path.to.value}}` templates are resolved against request payload fields.

Transport notes:

- `worker` (default): keeps one process alive and exchanges JSONL messages (`{"id","payload"}` -> `{"id","ok","result|error"}`).
- `spawn`: starts a process per request.
- `http`: forwards request payload to `http_endpoint` using `http_method` (default `POST`).

Examples:

- `examples/echo.spec.json` (spawn)
- `examples/echo.worker.spec.json` (persistent worker)
- `examples/echo.http.spec.json` (external HTTP)

## Config

ORBIT merges defaults + `~/.orbit/config.json` + `./.orbit/config.json` + env vars.

Supported keys:

```json
{
  "natsUrl": "nats://127.0.0.1:4222",
  "requestTimeoutMs": 5000,
  "retries": 2,
  "activeContext": "default",
  "kvBucket": "orbit_registry",
  "objectStoreBucket": "orbit_datapacks",
  "otel": {"endpoint":"http://127.0.0.1:4318/v1/traces","serviceName":"orbit-cli"},
  "performance": {
    "mode":"balanced",
    "traceSampleRate":0.2,
    "trustedLocal":false,
    "traceBufferMaxEvents":5000,
    "traceFlushIntervalMs":25
  },
  "routing": {"subjectPrefix":"orbit"},
  "api": {
    "authToken": "replace-with-strong-secret",
    "allowedHosts": ["127.0.0.1", "localhost", "::1"],
    "tls": {
      "enabled": false,
      "certFile": "~/.orbit/tls/server.crt",
      "keyFile": "~/.orbit/tls/server.key",
      "caFile": "~/.orbit/tls/ca.crt",
      "requestClientCert": false,
      "requireClientCert": false
    }
  },
  "runtime": {
    "serveMaxInflightGlobal":64,
    "serveMaxInflightPerMethod":16,
    "serveMaxQueueDepth":256,
    "workerPoolSize":2,
    "workerMaxPendingPerWorker":64,
    "apiMaxConcurrent":128,
    "apiMaxBodyBytes":1048576,
    "apiRequestTimeoutMs":15000,
    "agentMaxConcurrent":128,
    "agentMaxRequestBytes":262144,
    "publishDurableEnabled":false,
    "publishDurableTimeoutMs":2500,
    "callRateLimitPerSec":0,
    "circuitBreakerFailureThreshold":5,
    "circuitBreakerCooldownMs":10000,
    "circuitBreakerHalfOpenMax":1,
    "monitorMaxParallel":8,
    "monitorJitterMs":200,
    "monitorDownBackoffFactor":1.6,
    "monitorDownBackoffMaxMs":15000
  },
  "agent": {"enabled":true,"socketPath":"~/.orbit/agent.sock"},
  "contexts": {
    "default": {"natsUrl":"nats://127.0.0.1:4222","requestTimeoutMs":5000,"retries":2},
    "ci": {"natsUrl":"nats://127.0.0.1:5222","requestTimeoutMs":2000,"retries":1}
  },
  "logLevel": "info",
  "dataDir": "~/.orbit"
}
```

Production preset profiles for embedded-package use:

- low-noise: `examples/embedded.low-noise.config.json`
- high-throughput: `examples/embedded.high-throughput.config.json`
- shared-host (strict isolation on crowded machines): `examples/embedded.shared-host.config.json`

Quick start:

```bash
mkdir -p ~/.orbit
cp examples/embedded.low-noise.config.json ~/.orbit/config.json
# or:
# cp examples/embedded.high-throughput.config.json ~/.orbit/config.json
# cp examples/embedded.shared-host.config.json ~/.orbit/config.json
```

Env overrides:

- `ORBIT_NATS_URL`
- `ORBIT_TIMEOUT_MS`
- `ORBIT_RETRIES`
- `ORBIT_LOG_LEVEL`
- `ORBIT_DATA_DIR`
- `ORBIT_NATS_HOST`
- `ORBIT_NATS_PORT`
- `ORBIT_NATS_IMAGE`
- `ORBIT_NATS_CONTAINER`
- `ORBIT_CONTEXT`
- `ORBIT_KV_BUCKET`
- `ORBIT_OBJECT_BUCKET`
- `ORBIT_OTEL_ENDPOINT`
- `ORBIT_OTEL_SERVICE`
- `ORBIT_PERF_MODE` (`balanced`|`hyper`)
- `ORBIT_TRACE_SAMPLE_RATE` (`0..1`)
- `ORBIT_TRACE_BUFFER_MAX_EVENTS`
- `ORBIT_TRACE_FLUSH_INTERVAL_MS`
- `ORBIT_TRUSTED_LOCAL` (`1`)
- `ORBIT_SUBJECT_PREFIX`
- `ORBIT_API_TOKEN`
- `ORBIT_API_ALLOWED_HOSTS` (CSV, default `127.0.0.1,localhost,::1`)
- `ORBIT_API_TLS_ENABLED` (`1`|`0`)
- `ORBIT_API_TLS_CERT_FILE`
- `ORBIT_API_TLS_KEY_FILE`
- `ORBIT_API_TLS_CA_FILE`
- `ORBIT_API_TLS_REQUEST_CLIENT_CERT` (`1`|`0`)
- `ORBIT_API_TLS_REQUIRE_CLIENT_CERT` (`1`|`0`)
- `ORBIT_SERVE_MAX_INFLIGHT_GLOBAL`
- `ORBIT_SERVE_MAX_INFLIGHT_PER_METHOD`
- `ORBIT_SERVE_MAX_QUEUE_DEPTH`
- `ORBIT_WORKER_POOL_SIZE`
- `ORBIT_WORKER_MAX_PENDING`
- `ORBIT_API_MAX_CONCURRENT`
- `ORBIT_API_MAX_BODY_BYTES`
- `ORBIT_API_REQUEST_TIMEOUT_MS`
- `ORBIT_AGENT_ENABLED` (`1`|`0`)
- `ORBIT_AGENT_SOCKET`
- `ORBIT_AGENT_MAX_CONCURRENT`
- `ORBIT_AGENT_MAX_REQUEST_BYTES`
- `ORBIT_PUBLISH_DURABLE_ENABLED` (`1`|`0`)
- `ORBIT_PUBLISH_DURABLE_TIMEOUT_MS`
- `ORBIT_CALL_RATE_LIMIT_PER_SEC`
- `ORBIT_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
- `ORBIT_CIRCUIT_BREAKER_COOLDOWN_MS`
- `ORBIT_CIRCUIT_BREAKER_HALF_OPEN_MAX`
- `ORBIT_MONITOR_MAX_PARALLEL`
- `ORBIT_MONITOR_JITTER_MS`
- `ORBIT_MONITOR_DOWN_BACKOFF_FACTOR`
- `ORBIT_MONITOR_DOWN_BACKOFF_MAX_MS`

## Tracing

Each run writes JSONL events to `~/.orbit/traces/<run-id>.jsonl` with span timing, retries, and error codes.
If `ORBIT_OTEL_ENDPOINT` is set, trace events are also exported as OTLP spans over HTTP with retry/backoff.

## Benchmarking

`orbit bench` executes concurrent request/reply calls against one method and reports:

- total requests / success / failed
- throughput (req/s)
- latency: min/avg/p50/p95/p99/max

Ramp mode lets you grow load during the run:

- `--concurrency`: starting concurrency
- `--ramp-to`: max concurrency target
- `--ramp-step-s`: seconds between increases
- `--ramp-step-concurrency`: workers added per step

Use this as a repeatable baseline before/after service or broker changes.

`orbit bench-overhead` compares direct NATS RPC against local `orbit agent` IPC+NATS path and reports Orbit-added p50/p95 latency. Start the agent in another terminal first:

```bash
orbit agent
orbit bench-overhead text.upper --json @req.json --iterations 200
```

## Monitoring

`orbit monitor` emits newline-delimited JSON snapshots with:

- `service`
- `status` (`up`/`down`) from `$SRV.PING.<service>`
- `ping_latency_ms`
- `error_rate` (from `$SRV.STATS` endpoint counters when available)
- raw `$SRV.STATS.<service>` payload

Alerting options:

- `--alerts`: enable alert evaluation
- `--alert-latency-ms`: alert when ping latency exceeds threshold
- `--alert-error-rate`: alert when computed error rate exceeds threshold
- `--alert-consecutive`: require N consecutive failing checks before alerting
- `--alert-cooldown-s`: suppress repeated alert/resolve emissions for the same code within cooldown window
- `--alert-no-down`: disables default down-state alerts

When enabled, monitor emits explicit `event: "alert"` and `event: "alert_resolved"` rows.

## Contexts

```bash
orbit context list
orbit context set dev --nats-url nats://127.0.0.1:4222 --timeout-ms 5000 --retries 2
orbit context use dev
orbit context current
```

## Testing

```bash
npm run test
```

Tests cover:

- Envelope validation and tamper detection
- Retry/timeout behavior

## External API + SDKs

Orbit includes two SDKs and two CLIs for external integration:

- Orbit CLI: `orbit` (bus/admin runtime)
- Python CLI: `orbit-py` (HTTP API client)
- TypeScript SDK: `sdk/typescript`
- Python SDK: `sdk/python`

API service endpoints:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics` (Prometheus text)
- `POST /v1/ping`
- `POST /v1/call`
- `POST /v1/publish`
- `POST /v1/inspect`

Contract source:

- `docs/orbit-api-contract.yaml`

## Production Deployment Notes

- Secure NATS configuration templates (TLS + auth + accounts) and 3-node cluster examples are in `examples/nats/`.
- Hardened deployment checklist is in `docs/production-hardening.md`.
- Never expose NATS monitoring port publicly; bind monitoring/admin ports to localhost or private networks only.
