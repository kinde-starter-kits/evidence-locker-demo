# Build Log

## P0 — Workspace scaffold + CI boundary gate

Standalone demo scaffold. No app logic yet — tooling, structure, and the CI
boundary gate only.

### Workspace layout (npm workspaces)

- `apps/web/` — Next.js (App Router, TypeScript). The shell renders "Evidence
  Locker" and nothing else. `convex/` lives here and is the **only** place the
  Convex client is imported. Minimal `convex/schema.ts` + one trivial query
  (`convex/evidence.ts`); `npx convex codegen` emits `apps/web/convex/_generated`,
  which **is committed** (not gitignored).
- `packages/api-client/` — `createLockerClient({ agentToken, delegation })`, both
  params required with no defaults. The only path agents use to reach the app
  (HTTP + bearer token, later). Methods stubbed.
- `packages/agents/` — Mastra agents package. Zero dependency on `convex` or
  `apps/web`; reaches the app only through `@evidence-locker/api-client`. Stub
  agents only.

### Vendored auth component

- Built `@kinde-oss/kinde-convex-agent-auth` from the local checkout with
  `npm run build:clean`, then `npm pack` into `vendor/`.
- Wired into `apps/web` as a `file:` dependency:
  `vendor/kinde-oss-kinde-convex-agent-auth-0.1.0.tgz`.

### Tooling

- Shared TS config: `tsconfig.base.json`; each workspace extends it.
- Root ESLint (flat config, `typescript-eslint`) and Prettier.
- TypeScript pinned to `6.0.3` (the ceiling `typescript-eslint@8.x` supports,
  and the version the vendored component builds against).
- `.gitignore` covers `.env*`, `.next/`, `node_modules/`, and build-temp `*.tgz`
  (with `!vendor/*.tgz`), but **not** `apps/web/convex/_generated`.

### CI (GitHub Actions — `.github/workflows/ci.yml`, on every PR)

1. `npm ci` (clean install)
2. `npm run typecheck` (all workspaces)
3. `npm run lint`
4. `npm run boundary-check` — fails if `packages/agents` imports `convex`,
   `apps/web`, or `_generated`. Proven to fail on a forbidden import, then reverted.
5. `npm test` — vitest runs one placeholder test.
6. `npx convex codegen` freshness — `git diff --exit-code` on
   `apps/web/convex/_generated`.
