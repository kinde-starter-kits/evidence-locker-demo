# Changelog

## 0.1.0

Initial build of the Evidence Locker demo.

- **Workspace + CI** — npm workspaces monorepo (`apps/web`, `packages/agents`,
  `packages/api-client`); shared TS/ESLint/Prettier; a boundary check that fails if
  `packages/agents` imports `convex`/`apps/web`/`_generated`; vitest; a GitHub
  Actions workflow.
- **Human auth (Kinde)** — `@kinde-oss/kinde-auth-nextjs` login with three roles
  (Analyst / Reviewer / Custodian) whose permissions are the scopes the app reads.
  Login is optional.
- **Agent identities (Kinde M2M)** — three agents (Intake, Review, Disposition),
  each a distinct M2M application minting its own token via client-credentials.
- **Case-record store** — org-scoped, tenant-isolated records with a deterministic,
  idempotent seed of named legal case files and a `classification` field
  (public / confidential / privileged / pii).
- **Agent graph + event stream + tracing** — a Mastra graph runs the three agents,
  streams run events to Convex over HTTP, and traces to Langfuse (optional). A run's
  `correlationId` links its trace to its authority rows.
- **Broken mode** — actions performed and logged to a deliberately blind
  `activityLog` that records what happened, not who authorized it; an unauthorized
  delete is indistinguishable from a legitimate one.
- **Enforced mode** — every action goes through the vendored
  `@kinde-oss/kinde-convex-agent-auth` component: token verified, action authorized,
  and one hash-chained provenance row written (identity + delegation + effective
  scopes + decision). The over-scoped Review delete is denied and recorded; the file
  survives.
- **Provenance + integrity** — per-org SHA-256 hash chain over RFC 8785 (JCS)
  canonical rows, with a `verifyChain` query that reports a clean chain or the first
  break. (Not production-grade tamper-proofing — see the README.)
- **UI** — a guided, self-explaining dashboard (Kinde light brand): scenario, the
  three agents, an on-page Broken/Enforced server-mode toggle, live event stream,
  the blind-log-vs-provenance contrast, replay, and verify-integrity.
- **End-to-end narrative** — `npm run e2e` runs the whole story off one seed in both
  modes, in-process (no deployment, no live Kinde), asserting each beat.
