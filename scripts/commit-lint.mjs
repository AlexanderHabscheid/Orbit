#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const GENERIC_PATTERNS = [
  /^modular\s+\d+\/\d+:/i,
  /^(update|changes|misc|stuff|temp|wip|progress)\b/i,
  /^update\s+[\w./-]+$/i,
  /^add\s+[\w./-]+$/i,
  /^fix\s+[\w./-]+$/i,
];

const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "perf",
  "security",
  "revert",
]);

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args[0] === "--edit") {
    return { mode: "edit", file: args[1] ?? ".git/COMMIT_EDITMSG" };
  }
  if (args[0] === "--upstream") {
    return { mode: "upstream" };
  }
  if (args[0] === "--range") {
    if (!args[1]) {
      throw new Error("missing range after --range");
    }
    return { mode: "range", range: args[1] };
  }
  throw new Error("usage: node scripts/commit-lint.mjs --edit [path] | --upstream | --range <git-range>");
}

function parseMessage(raw) {
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"));
  const subject = (lines.find((line) => line.trim().length > 0) ?? "").trim();
  const subjectIndex = lines.findIndex((line) => line.trim() === subject);
  const body = lines
    .slice(subjectIndex === -1 ? 1 : subjectIndex + 1)
    .join("\n")
    .trim();
  return { subject, body };
}

function validateSubject(subject) {
  const issues = [];
  if (!subject) {
    issues.push("subject is empty");
    return issues;
  }

  if (subject.length < 18) {
    issues.push("subject is too short; describe the intent, not just the file touched");
  }

  if (subject.length > 72) {
    issues.push("subject exceeds 72 characters");
  }

  if (subject.endsWith(".")) {
    issues.push("subject should not end with a period");
  }

  const match = subject.match(/^([a-z]+)(\([^)]+\))?!?:\s+(.+)$/);
  if (!match) {
    issues.push("subject must match conventional format: type(scope): summary");
    return issues;
  }

  const [, type, , summary] = match;
  if (!ALLOWED_TYPES.has(type)) {
    issues.push(`unsupported commit type "${type}"`);
  }

  for (const pattern of GENERIC_PATTERNS) {
    if (pattern.test(summary)) {
      issues.push("summary is too generic; explain the behavior or outcome");
      break;
    }
  }

  if (/^\d+\/\d+/.test(summary)) {
    issues.push("summary should not encode progress counters");
  }

  return issues;
}

function validateMessage(raw) {
  const { subject, body } = parseMessage(raw);
  const issues = validateSubject(subject);
  const type = subject.match(/^([a-z]+)/)?.[1];
  if (["feat", "fix", "refactor", "perf", "security"].includes(type) && body.length === 0) {
    issues.push(`body is required for ${type} commits; explain why the change matters`);
  }
  return { subject, issues };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `failed to run git ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function lintMessage(raw, label) {
  const { subject, issues } = validateMessage(raw);
  if (issues.length === 0) {
    return;
  }

  const renderedIssues = issues.map((issue) => `- ${issue}`).join("\n");
  fail(
    `Commit message rejected for ${label}:\n` +
      `subject: ${subject || "<empty>"}\n` +
      `${renderedIssues}\n\n` +
      `Example:\n` +
      `feat(federation): verify remote challenge token before publish\n\n` +
      `Why:\n` +
      `- prevent replayed challenge responses from reaching ingress\n\n` +
      `Validation:\n` +
      `- npm run lint\n`
  );
}

function auditRange(range) {
  const result = spawnSync(
    "git",
    ["log", "--format=%H%x1f%s%x1f%b%x1e", range],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    fail(result.stderr.trim() || `failed to read git range ${range}`);
  }

  const failures = [];
  const entries = result.stdout
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [hash = "", subject = "", body = ""] = entry.split("\x1f");
    const { issues } = validateMessage(`${subject}\n\n${body}`);
    if (issues.length > 0) {
      failures.push({ hash, subject, issues });
    }
  }

  if (failures.length === 0) {
    console.log(`Commit audit passed for ${range}`);
    return;
  }

  const lines = failures.flatMap(({ hash, subject, issues }) => [
    `${hash.slice(0, 7)} ${subject}`,
    ...issues.map((issue) => `  - ${issue}`),
  ]);

  const base = range.includes("..") ? range.split("..")[0] : "HEAD~1";
  fail(
    `Commit audit failed for ${range}.\n` +
      `${lines.join("\n")}\n\n` +
      `Rewrite unpublished history with:\n` +
      `git rebase -i ${base}\n` +
      `Use reword for message-only fixes and --force-with-lease only after coordination.\n`
  );
}

const args = parseArgs(process.argv);
if (args.mode === "edit") {
  lintMessage(readFileSync(args.file, "utf8"), args.file);
} else if (args.mode === "upstream") {
  const upstream = readGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  auditRange(`${upstream}..HEAD`);
} else {
  auditRange(args.range);
}
