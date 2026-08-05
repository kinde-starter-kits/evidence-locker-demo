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

## P5 — Broken mode and the audit-gap repro

- `AUTHZ_MODE` is read SERVER-SIDE only (`apps/web/convex/authzMode.ts`,
  `getAuthzMode()` → `process.env.AUTHZ_MODE`), defaulting to `broken`. There is
  no `mode` argument on any function and the HTTP handler never reads it from the
  body/header/query, so a request cannot choose its mode.
- Action path: `POST /agent/actions` (http.ts) → `agentActions.performAction`.
  In broken mode it performs the action (via the shared `apply*` record helpers)
  with **no identity check, no scope check**, and writes ONE deliberately-blind
  `activityLog` row. Enforced mode fails closed until P6.
- Graph: the Review agent (scopes `records:read`, `records:annotate` — NOT
  `records:delete`) attempts `records:delete` and, in broken mode, SUCCEEDS.
  The Disposition agent (holds `records:delete`) performs a legitimate delete for
  contrast. Both go through `createLockerClient` over HTTP — no Convex import.

### The two activityLog rows, side by side (captured from the repro)

```
Review  (UNAUTHORIZED — has no records:delete):
  { orgCode:"orgA", actorAgentId:"review",      action:"records:delete",
    resourceType:"records", resourceId:"…0000records", ts:1785847788516 }

Disposition (LEGITIMATE — holds records:delete):
  { orgCode:"orgA", actorAgentId:"disposition", action:"records:delete",
    resourceType:"records", resourceId:"…0001records", ts:1785847788519 }
```

The ONLY differences are `actorAgentId` (which agent) and the incidental
`_id`/`ts`/`resourceId`. Neither row carries `decision`, `scopes`,
`effectiveScopes`, `delegationId`, `authorityRootKind`, or any other authority
field. Strip `actorAgentId` and the two rows are byte-identical
(`{orgCode:"orgA", action:"records:delete", resourceType:"records"}`). Given only
`activityLog`, you cannot tell the unauthorized delete from the authorized one —
which is exactly the failure this demo exists to fix (P6 adds the authority-bearing
`provenance` rows via the Kinde agent-auth component).

## P6 — Enforced mode: authority record per action, over-scoped delete denied

- Vendored component wired: `convex/convex.config.ts` (`defineApp` + `app.use(agentAuth,…)`
  passing `KINDE_DOMAIN`/`KINDE_AUDIENCE`/`DELEGATION_SIGNING_SECRET`),
  `convex/agentAuth.ts` (`new AgentAuth(components.agentAuth)` + admin-only INTERNAL
  wrappers `registerAgent`/`startInstance`/`revokeAgent`). Codegen now includes the
  component.
- Enforced action path (`convex/agentActions.ts`, `performAction` internalAction):
  verify token (`verifyCaller`, throws on invalid → 401) → `startInstance`
  (runId = `${correlationId}:${agentId}`, unique per agent in a run) →
  `authorize(ctx, token, {instanceId, action, enforceTokenScopes:true, requireOrgCode:true})`
  → commit: apply via shared `apply*` helper on allow, then write ONE provenance
  row (allow OR deny). A deny is `decision.allowed === false` (returned, recorded —
  not thrown). Broken mode still writes the blind `activityLog` row.
- Provenance is OUR hash-chained authority record, built from `{caller, decision}`;
  the component keeps its OWN `audit` store. `rowHash = SHA-256( JCS(rowBody) + prevHash )`
  via `canonicalize` (RFC 8785, never JSON.stringify); genesis prevHash = 64 zeros;
  `seq`/`prevHash` read from the last row in the same mutation. `verifyChain({orgCode})`
  recomputes and reports the first break.

### An allow row and a deny row, side by side (captured; contrast P5)

```
DENY  (Review — over-scoped delete, records:delete NOT granted):
  seq:0  decision:"deny"  action:"records:delete"
  actorSub:"m2m_review"  authorityRootKind:"agent"
  effectiveScopes:["records:read","records:annotate"]
  denyReason:"insufficient_scope"  requiredScopes:["records:delete"]
  prevHash:0000…0000   rowHash:b1ade029…4aba      → record NOT deleted

ALLOW (Disposition — legitimate delete, records:delete granted):
  seq:1  decision:"allow"  action:"records:delete"
  actorSub:"m2m_disposition"  authorityRootKind:"agent"
  effectiveScopes:["records:read","records:redact","records:export","records:delete"]
  prevHash:b1ade029…4aba   rowHash:fae20fb6…7501    → record deleted
```

Unlike P5's two indistinguishable `activityLog` rows, EACH provenance row carries
identity (`actorSub`), the decision, the effective scopes, and — on the deny — the
`requiredScopes` it lacked. The chain links them: the deny row's `rowHash` is the
allow row's `prevHash`.

### verifyChain: pass, and tamper detected

```
clean chain      → { ok: true, length: 2 }
after tampering  → { ok: false, brokenAtSeq: 0, reason: "row_hash_mismatch" }
  (patched seq-0's action to "records:tampered"; recomputed rowHash no longer matches)
```

### Still needs live verification (real Kinde, my Convex dev deployment)

The tests use jose-minted RS256 tokens + a stubbed JWKS — a deterministic in-process
path that exercises real `verifyCaller`/`authorize`. What I have NOT verified live and
must confirm against my Kinde tenant + Convex dev deployment:
- real agent token minting (`mintAgentToken`, P2) with the three M2M apps;
- a real `authorize()` decision over a live Kinde-issued token (JWKS from my tenant);
- setting the Convex deployment env: `AUTHZ_MODE=enforced`, `KINDE_DOMAIN`,
  `KINDE_AUDIENCE` (required in live mode), `DELEGATION_SIGNING_SECRET`
  (`npx convex env set …`), and registering the three agents against their real
  Kinde `client_id`s.
