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
  setTimeout(() => {
    process.stdout.write(`${JSON.stringify({ id: parsed.id, ok: true, result: { ok: true } })}\n`);
  }, 200);
});
