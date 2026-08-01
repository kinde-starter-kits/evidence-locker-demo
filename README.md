# Evidence Locker (demo)

A standalone demo monorepo (npm workspaces).

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js (App Router, TypeScript) app. `convex/` lives here and is the **only** place the Convex client is imported. |
| `packages/api-client` | `createLockerClient({ agentToken, delegation })` — the only path agents use to reach the app (HTTP + bearer token). Stubbed. |
| `packages/agents` | Mastra agents. Zero dependency on `convex` or `apps/web`; reaches the app only through `@evidence-locker/api-client`. Stubbed. |
| `vendor/` | Vendored `@kinde-oss/kinde-convex-agent-auth` tarball, wired into `apps/web` as a `file:` dependency. |

## Scripts

```bash
npm install          # install all workspaces
npm run typecheck    # tsc --noEmit across every workspace
npm run lint         # eslint .
npm test             # vitest run
npm run boundary-check   # fail if packages/agents imports convex/apps/web/_generated
npm run codegen      # convex codegen in apps/web
```

## Boundaries

`packages/agents` must never import `convex`, `apps/web`, or any `_generated`
code. CI enforces this with `scripts/check-boundaries.mjs`.

See [BUILD_LOG.md](./BUILD_LOG.md) for the P0 build record.
