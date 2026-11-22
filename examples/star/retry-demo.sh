#!/usr/bin/env bash
set -euo pipefail

for dependency in docker node orbit; do
  command -v "$dependency" >/dev/null || {
    printf 'Required command: %s\n' "$dependency" >&2
    exit 1
  }
done

demo_dir=$(mktemp -d)
broker=
worker=
cleanup() {
  if [[ -n "$worker" ]]; then
    kill "$worker" 2>/dev/null || true
    wait "$worker" 2>/dev/null || true
  fi
  if [[ -n "$broker" ]]; then docker rm -f "$broker" >/dev/null 2>&1 || true; fi
  cd /
  rm -rf -- "$demo_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$demo_dir"

broker=$(docker run --rm -d -p 127.0.0.1::4222 nats:2.11-alpine -js)
ORBIT_NATS_URL="nats://$(docker port "$broker" 4222/tcp)"
export ORBIT_NATS_URL
unset ORBIT_OTEL_ENDPOINT
mkdir -p .orbit
node <<'JS'
const { writeFileSync } = require('node:fs');
writeFileSync('.orbit/config.json', JSON.stringify({
  activeContext: 'retry-demo',
  contexts: { 'retry-demo': {
    natsUrl: process.env.ORBIT_NATS_URL,
    requestTimeoutMs: 3000,
    retries: 0
  } },
  dataDir: '.orbit/demo',
  otel: { endpoint: '' },
  logLevel: 'info',
  agent: { enabled: false },
  performance: { traceSampleRate: 1 },
  runtime: { workerPoolSize: 1 }
}));
writeFileSync('worker.json', JSON.stringify({
  version: '1.0.0',
  methods: { upper: {
    transport: 'worker',
    command: 'node',
    args: ['worker.cjs']
  } }
}));
JS
cat > worker.cjs <<'JS'
const { createInterface } = require('node:readline');
let skippedReply = false;

createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, payload } = JSON.parse(line);
  if (payload.skipFirstReply && !skippedReply) {
    skippedReply = true;
    return;
  }
  const text = payload.text.toUpperCase();
  console.log(JSON.stringify({ id, ok: true, result: { text } }));
});
JS

printf '%s\n' '$ orbit serve --name text --spec worker.json --concurrency 2'
orbit serve --name text --spec worker.json --concurrency 2 > worker.log 2>&1 &
worker=$!
for ((check = 0; check < 100; check++)); do
  if grep -q 'service adapter online' worker.log; then break; fi
  if ! kill -0 "$worker" 2>/dev/null; then break; fi
  sleep 0.1
done
grep 'service adapter online' worker.log || { cat worker.log >&2; exit 1; }

printf '\n%s\n' "\$ orbit call text.upper --json '{\"text\":\"hello, orbit\"}'"
orbit call text.upper --json '{"text":"hello, orbit"}'

printf '\n%s\n%s\n' "\$ orbit call text.upper --json '{\"text\":\"retry worked\",\"skipFirstReply\":true}' \\" \
  '    --run-id retry-demo --timeout-ms 650 --retries 1'
orbit call text.upper --json '{"text":"retry worked","skipFirstReply":true}' \
  --run-id retry-demo --timeout-ms 650 --retries 1

printf '\n%s\n' '$ orbit trace retry-demo'
timeline=$(orbit trace retry-demo)
printf '%s\n' "$timeline"
grep -qE ' \| retry \| .*error=TIMEOUT' <<< "$timeline"
grep -qE ' \| attempt_reply \| .*retry=1' <<< "$timeline"
grep -qE ' \| call_end \| .*retry=1' <<< "$timeline"
