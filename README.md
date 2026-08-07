# Evidence Locker

This is a demo of an evidence locker for legal case files where AI agents intake, review, and dispose of documents. The problem: a normal log records **what** an agent did, not **whether it was allowed** — so you cannot prove to an auditor that a deletion was authorized.

This demo fixes that: every agent action is authorized against the agent's identity and scopes, and each decision is written to a replayable, tamper-evident
authorized-action record.

## The honest three-layer split

These are separate concerns owned by separate systems. The demo does not blur them:

- **Kinde** issues and verifies each agent's identity and scopes (and the human
  roles behind them). Kinde is the identity and permission authority. It does **not**
  ship the audit/provenance layer.
- **`@kinde-oss/kinde-convex-agent-auth`** (the vendored Convex component) makes the authorization **decision** — verify the agent's token, authorize the action against its scopes for the run instance — and produces the authorized-action result. It keeps its **own** append-only decision audit.
- **Convex** stores the replayable, **hash-chained provenance** rows this app builds from each decision, and drives the reactive UI. This provenance table is *ours*, distinct from the component's audit.
- **Langfuse** (optional) traces **how** the run executed — spans, latency. It is
  **not** the authority record. A run's `correlationId` links its Langfuse trace to its provenance rows.

## How the demo proves its point

Two modes, one global server switch (the on-page **Demo control**, backed by server
state — a request can never choose its own mode):

- **Broken mode** — actions are performed and logged, but not authorized. The blind
  `activityLog` records the Review agent's over-scoped delete and a legitimate
  Disposition delete **identically**: nothing on either row says who was allowed.
- **Enforced mode** — every action goes through the component. The Review agent
  (scopes `records:read` + `records:annotate`) attempts `records:delete` and is
  **DENIED** (`insufficient_scope`, needed `records:delete`); the file survives. The
  Disposition agent (holds `records:delete`) is **ALLOWED**. Each decision writes one
  provenance row carrying identity, effective scopes, and the decision. **Verify
  integrity** recomputes the per-org chain and reports clean or the first break.

Run the whole story headless in both modes with **`npm run e2e`**.

## Tamper-evidence — honestly scoped

Provenance is a **per-org SHA-256 hash chain**: `rowHash = SHA-256( JCS(rowBody) +
prevHash )`, where `JCS` is the RFC 8785 canonicalization of the row (genesis
`prevHash` = 64 zeros). `verifyChain` recomputes it and reports the first break.

This proves in-store rows were not altered or reordered after the fact. **It is not
production-grade tamper-proofing.** A production system would go further —
Merkle-tree inclusion proofs, external root anchoring (e.g. SCITT-style transparency
logs, HSM-held roots), and separation of duties between the writer and the anchor.
This demo does **not** implement those.

## Extensibility

The three agents and their scopes are **fixed for this demo**. In production they
come from your Kinde roles and API scopes — register your own M2M agents and grant
each the scopes its job requires; the authorization and provenance path is unchanged.

## Layout

| Path | What it is |
| --- | --- |
| `apps/web` | Next.js (App Router) app. `convex/` lives here and is the only place the Convex client is imported. Holds the schema, action path, provenance chain, and UI. |
| `packages/agents` | Mastra agent graph. Zero dependency on `convex`/`apps/web`; reaches the app only over HTTP via `@evidence-locker/api-client`. |
| `packages/api-client` | The only path agents use to reach the app (HTTP + bearer token). |
| `vendor/` | The vendored `@kinde-oss/kinde-convex-agent-auth` tarball (see note below). |
| `scripts/` | Boundary check, the `e2e` narrative, and a live enforced-mode verifier. |

The boundary (`packages/agents` never imports `convex`/`apps/web`/`_generated`) is
enforced by `scripts/check-boundaries.mjs` and CI.

## Quickstart

```bash
npm ci

# 1) Convex dev deployment (writes NEXT_PUBLIC_CONVEX_URL / _SITE_URL to apps/web/.env.local)
cd apps/web && npx convex dev            # keep running

# 2) Seed the named case files (one org)
npx convex run seed:seedLocker '{"orgCode":"orgA"}'

# 3) Web app
npm run dev                              # http://localhost:3000
```

Env vars (copy the `.env.example` files and fill from your dashboards):

- **`apps/web/.env.local`** — Kinde **web** login (`KINDE_CLIENT_ID`,
  `KINDE_CLIENT_SECRET`, `KINDE_ISSUER_URL`, site/redirect URLs) and Convex
  (`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`). For enforced runs
  triggered from the UI, also the M2M creds below. **Do NOT set `KINDE_AUDIENCE`
  here — it breaks human sign-in.**
- **`packages/agents/.env.local`** — Kinde **M2M** (`KINDE_M2M_TOKEN_URL`,
  `KINDE_M2M_AUDIENCE`, and `INTAKE`/`REVIEW`/`DISPOSITION` `_CLIENT_ID`/`_SECRET`),
  and optional Langfuse (`LANGFUSE_PUBLIC_KEY`/`SECRET_KEY`/`BASE_URL`).
- **Convex deployment env** (`npx convex env set …`) — `AUTHZ_MODE` (fallback
  default; the on-page toggle overrides it), `KINDE_DOMAIN`, `KINDE_AUDIENCE`
  (required in live mode), `DELEGATION_SIGNING_SECRET`.

Login is **optional** — an anonymous visitor gets the full working page. Flip
**Broken ↔ Enforced** with the on-page Demo control and re-run to see the contrast.
See **[DEPLOY.md](./DEPLOY.md)** to deploy, and **[BUILD_LOG.md](./BUILD_LOG.md)** for
the phase-by-phase build record.

## Note on the vendored component

`@kinde-oss/kinde-convex-agent-auth` is currently **vendored** as
`vendor/kinde-oss-kinde-convex-agent-auth-0.1.0.tgz` and wired into `apps/web` as a
`file:` dependency. When the package is published, swap the `file:` dependency in
`apps/web/package.json` for the published version and remove the tarball.

## Scripts

```bash
npm run typecheck        # tsc --noEmit across every workspace
npm run lint             # eslint .
npm test                 # vitest run (unit + integration)
npm run e2e              # the full narrative, both modes, headless
npm run boundary-check   # fail if packages/agents imports convex/apps-web/_generated
npm run codegen          # convex codegen in apps/web
```

## License

MIT — see [LICENSE](./LICENSE).
