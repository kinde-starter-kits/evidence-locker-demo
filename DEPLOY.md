# Deploy

The runbook for deploying the web app to **Vercel** against the existing Convex
**cloud dev** deployment. This is a demo deploy, not a production tier — read
[Known limits](#known-limits) first: the full agent run does not complete on
Vercel's serverless model, so the agent story is best shown locally or via
`npm run e2e`.

## Target

- **Web app** → Vercel. Root Directory = **`apps/web`**.
- **Backend** → your existing Convex **cloud dev** deployment (from `npx convex dev`).
  Not a Convex prod tier.

## 1. Convex deployment env

Set on the Convex deployment (dashboard, or `npx convex env set …` from `apps/web`):

```bash
npx convex env set AUTHZ_MODE enforced          # fallback default; the on-page toggle overrides it
npx convex env set KINDE_DOMAIN <your>.kinde.com # no protocol
npx convex env set KINDE_AUDIENCE <locker-api-audience>   # required in live mode
npx convex env set DELEGATION_SIGNING_SECRET <strong-secret>
```

`KINDE_AUDIENCE` here must equal the `KINDE_M2M_AUDIENCE` the agents mint tokens for.

## 2. Register the agents + seed (against the deployment)

Run once against the deployment (`npx convex run …` from `apps/web`). `kindeClientId`
is each M2M app's client id; `orgCode` and the token `org_code` must match.

```bash
# Analyst / intake — read + create
npx convex run agentAuth:registerAgent '{"name":"Intake","slug":"intake","orgCode":"<ORG>","kindeClientId":"<INTAKE_CLIENT_ID>","allowedTools":["records:read","records:create","records:annotate","records:redact","records:export","records:delete"],"scopes":["records:read","records:create"]}'
# Reviewer / review — read + annotate (NO delete)
npx convex run agentAuth:registerAgent '{"name":"Review","slug":"review","orgCode":"<ORG>","kindeClientId":"<REVIEW_CLIENT_ID>","allowedTools":["records:read","records:create","records:annotate","records:redact","records:export","records:delete"],"scopes":["records:read","records:annotate"]}'
# Custodian / disposition — read + redact + export + delete
npx convex run agentAuth:registerAgent '{"name":"Disposition","slug":"disposition","orgCode":"<ORG>","kindeClientId":"<DISPOSITION_CLIENT_ID>","allowedTools":["records:read","records:create","records:annotate","records:redact","records:export","records:delete"],"scopes":["records:read","records:redact","records:export","records:delete"]}'

npx convex run seed:seedLocker '{"orgCode":"<ORG>"}'
```

## 3. Vercel env

Set on the Vercel project (Root Directory `apps/web`):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL (`https://<dep>.convex.cloud`) |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex HTTP actions URL (`https://<dep>.convex.site`) |
| `NEXT_PUBLIC_DEMO_ORG_CODE` | the org you seeded (e.g. `orgA`) |
| `KINDE_CLIENT_ID`, `KINDE_CLIENT_SECRET` | Kinde **web** app credentials |
| `KINDE_ISSUER_URL` | `https://<your>.kinde.com` |
| `KINDE_SITE_URL` | the deployed origin (`https://<app>.vercel.app`) |
| `KINDE_POST_LOGIN_REDIRECT_URL`, `KINDE_POST_LOGOUT_REDIRECT_URL` | the deployed origin |
| `KINDE_M2M_TOKEN_URL`, `KINDE_M2M_AUDIENCE` | agent token minting (for in-UI enforced runs) |
| `INTAKE_/REVIEW_/DISPOSITION_CLIENT_ID` + `_SECRET` | the three M2M apps |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | optional tracing |

**Do NOT set `KINDE_AUDIENCE` on the web app** — the `kinde-auth-nextjs` SDK would
attach it to the human sign-in flow and break login. `KINDE_AUDIENCE` is a Convex
deployment env var only (step 1).

## 4. Kinde dashboard

Update the Kinde web app's **allowed callback** and **logout redirect** URLs to the
deployed origin (`https://<app>.vercel.app` and its `/api/auth/kinde_callback`).

## Known limits

- **The agent run path won't complete on Vercel serverless.** The in-UI "Run the
  agents" button (`apps/web/app/api/run/route.ts`) runs the Mastra graph server-side;
  that long-lived worker-style execution does not fit Vercel's short-lived serverless
  functions and will not reliably finish there.
- **What works deployed:** anonymous + Kinde login, the scenario/walkthrough, the
  on-page Broken/Enforced toggle and live banner, reading the seeded case files, the
  live event stream and provenance panels for existing runs, and **Verify integrity**.
- **What to show elsewhere:** trigger real runs **locally** (`npm run dev` + the Run
  button) or headless with **`npm run e2e`** (both modes, fully in-process). You can
  also drive an enforced run against the deployment with
  `scripts/verify-enforced.ts <ORG>` and watch the UI update.
