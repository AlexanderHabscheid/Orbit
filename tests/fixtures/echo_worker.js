import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  const payload = parsed?.payload ?? {};
  const text = String(payload.text ?? "");
  const out = { id: parsed.id, ok: true, result: { echoed: text.toUpperCase() } };
  process.stdout.write(`${JSON.stringify(out)}\n`);
});
