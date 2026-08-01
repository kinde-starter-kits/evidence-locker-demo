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

## P4 — Mastra graph + Convex event stream + Langfuse tracing

### Pinned versions (from live npm)

- `@mastra/core` — **1.55.0** (exact)
- `@mastra/langfuse` — **1.4.6** (exact)
- Supporting (to satisfy `@mastra/langfuse` peers): `@mastra/observability` 1.16.3,
  `@opentelemetry/api` ^1.9.0, `@opentelemetry/sdk-trace-base` ^2.0.1, `zod` ^4.4.3.

### What landed

- **packages/agents** — `runLockerGraph()` builds a Mastra `Workflow` of three
  steps (intake → review → disposition), run via Mastra's real runtime. The
  workflow `runId` is the `correlationId`, stamped on every emitted event, so the
  Langfuse trace and the Convex events share one id. Langfuse is wired under
  `observability.configs.langfuse` with `LangfuseExporter({ ..., realtime: true })`,
  built ONLY when `LANGFUSE_PUBLIC_KEY`/`SECRET_KEY` are present — tracing is
  optional, no keys ⇒ no exporter, no crash. Deterministic default (no LLM key);
  optional BYOK reasoner for the review step falls back to deterministic on ANY
  error. Still zero convex/apps-web imports — events go out via the api-client only.
- **packages/api-client** — added `recordEvent(event)` (real HTTP POST with bearer
  + delegation to `/agent/events`).
- **apps/web/convex** — new `runEvents` table (indexes `by_org`,
  `by_org_correlation`), `runEvents.ingest` (server-assigns monotonic `seq`,
  writes under the given orgCode only) + `runEvents.listRunEvents`, and an HTTP
  ingest endpoint `POST /agent/events` in `http.ts` (unauthenticated for now —
  P6 wraps it).

Live Langfuse traces need `LANGFUSE_*` keys in `packages/agents/.env.local`,
verified in the Langfuse dashboard.
