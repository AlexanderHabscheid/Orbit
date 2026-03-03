# Orbit Release Cut Runbook (`v0.1.x`)

This runbook assumes all validation gates are green and package versions are aligned.

## Current Version Alignment

- root npm package: `0.1.0`
- TypeScript SDK package: `0.1.0`
- Python SDK package: `0.1.0`

## Preconditions

- npm trusted publishing is configured for:
  - `orbit-bus`
  - `orbit-sdk-typescript`
- PyPI trusted publishing is configured for:
  - `orbit-sdk`
- GitHub Actions release workflow exists: `.github/workflows/release.yml`
- Working tree is clean.

## 1. Ensure Git History Exists

If this repo has no commit yet, run:

```bash
git init
git add .
git commit -m "chore: production-ready release baseline"
```

If commits already exist, skip this step.

## 2. Final Preflight (Local)

```bash
npm ci
npm run lint
npm test
npm run build
npm run test:integration
npm audit --omit=dev
npm pack --dry-run

cd sdk/typescript
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run
cd ../..

cd sdk/python
python3 -m unittest discover -s tests -p "test_*.py"
python3 -m build
python3 -m twine check dist/*
cd ../..
```

## 3. Bump Version (Patch Example: `0.1.0` -> `0.1.1`)

Update these files to the same target version:

- `package.json`
- `sdk/typescript/package.json`
- `sdk/python/pyproject.toml`
- `CHANGELOG.md` (move Unreleased entries under new version header)

## 4. Commit Release Payload

```bash
git add package.json package-lock.json sdk/typescript/package.json sdk/python/pyproject.toml CHANGELOG.md
git commit -m "chore(release): v0.1.1"
```

## 5. Tag and Push

```bash
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin main
git push origin v0.1.1
```

Pushing tag `v0.1.1` triggers `.github/workflows/release.yml`.

## 6. Post-Release Verification

Verify:

- GitHub Release created with attached artifacts
- npm publish success for both packages
- PyPI publish success for `orbit-sdk`
- Provenance attestations are attached

## Recommended `v0.1.x` Sequence

- `v0.1.1`: production-readiness baseline release
- `v0.1.2`: any fast-follow packaging/docs/smoke-fix release only if needed
- `v0.1.3`: first stabilization patch after external user feedback
