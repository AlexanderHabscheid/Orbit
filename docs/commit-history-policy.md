# Commit History Policy

Orbit commit history should explain behavior, intent, and validation. Messages like `update file`, `misc fixes`, or numbered progress labels such as `modular 12/50` are not acceptable because they hide the reason for the change and make release review harder.

## Standard

- Use `type(scope): summary` for the subject line.
- Keep the subject between 18 and 72 characters.
- Describe the outcome or behavior change, not just the file touched.
- Add a body for `feat`, `fix`, `refactor`, `perf`, and `security` commits.
- Include a short validation section when tests or lint were run.

Example:

```text
fix(api): preserve request timeout overrides in TypeScript client

Why:
- SDK callers need per-request deadlines to override constructor defaults

What:
- wire timeoutMs through the fetch timeout controller path

Validation:
- npm run lint
- npm run test
```

## Repo Setup

Install the repo-managed hook and commit template:

```bash
npm run commit:install
```

Audit the current branch before pushing:

```bash
npm run commit:audit
```

## Rewriting History

Only rewrite unpublished or explicitly coordinated history. For local cleanup before push:

```bash
git rebase -i "$(git rev-parse --abbrev-ref --symbolic-full-name @{upstream})"
```

- Use `reword` when only the message needs to change.
- Use `squash` or `fixup` when multiple low-value commits should become one meaningful change.
- If the branch already exists on a shared remote, coordinate first and push with `--force-with-lease`, not `--force`.
