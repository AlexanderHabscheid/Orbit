# Orbit Release Policy

## Versioning
- Orbit uses SemVer.
- `MAJOR`: breaking API/CLI contract changes.
- `MINOR`: backward-compatible feature additions.
- `PATCH`: backward-compatible fixes.

## Release Gates
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run test:integration` (Docker/NATS)
- TypeScript SDK build/typecheck/pack dry run
- Python SDK compile/build/twine check
- Artifact smoke install (`orbit`, `echocore`, `orbit-ts`, `orbit-py` help commands from packaged artifacts)

## Publishing
- Root package and TypeScript SDK publish to npm from signed Git tags `v*` via trusted publishing (OIDC).
- Python SDK publishes from the same tag via Trusted Publishing.
- Release assets are attested with GitHub build provenance.
- Operational cut sequence is documented in `docs/release-cut-runbook.md`.

## Supply-Chain Gates
- Dependency review check on pull requests.
- CodeQL static analysis for JavaScript and Python.
- Dependabot update automation for npm, pip, and GitHub Actions.

## Changelog Discipline
- Every user-visible change updates `CHANGELOG.md` under `Unreleased`.
- On release, move entries to a dated version section.
