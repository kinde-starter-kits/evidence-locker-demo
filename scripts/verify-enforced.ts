// One-shot LIVE verification of P6 enforced mode against your Convex dev deployment
// + Kinde. It mints a REAL Review-agent token and a REAL Disposition-agent token,
// runs records:delete for each through the enforced HTTP path (POST /agent/actions),
// then prints the two provenance rows + verifyChain — so you SEE the Review delete
// DENIED and the Disposition delete ALLOWED against live Kinde.
//
//   npx --yes tsx scripts/verify-enforced.ts <orgCode>
//
// Lives at repo-root scripts/ (not packages/agents/) on purpose: it imports convex,
// which the boundary check forbids inside packages/agents.
//
// Prereqs:
//   • Convex deployment env set: AUTHZ_MODE=enforced, KINDE_DOMAIN, KINDE_AUDIENCE,
//     DELEGATION_SIGNING_SECRET  (see the accompanying `npx convex env set` commands)
//   • Records seeded:  npx convex run seed:seedLocker '{"orgCode":"<orgCode>"}'
//   • The three agents registered against their real Kinde client_ids
//   • packages/agents/.env.local: KINDE_M2M_TOKEN_URL, KINDE_M2M_AUDIENCE,
//     REVIEW_CLIENT_ID/SECRET, DISPOSITION_CLIENT_ID/SECRET  (KINDE_M2M_AUDIENCE
//     MUST equal the deployment's KINDE_AUDIENCE)
//   • apps/web/.env.local: NEXT_PUBLIC_CONVEX_URL, NEXT_PUBLIC_CONVEX_SITE_URL
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {mintAgentToken} from '@evidence-locker/agents';

function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // optional file
  }
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value.length > 0 && process.env[match[1]] === undefined) {
      process.env[match[1]] = value;
    }
  }
}

loadEnvFile('apps/web/.env.local');
loadEnvFile('packages/agents/.env.local');

const orgCode = process.argv[2] ?? process.env.LOCKER_ORG_CODE;
if (orgCode === undefined || orgCode.length === 0) {
  console.error('Usage: npx --yes tsx scripts/verify-enforced.ts <orgCode>');
  process.exit(1);
}

const convexUrl = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
const siteUrl = process.env.CONVEX_SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
if (convexUrl === undefined || siteUrl === undefined) {
  console.error('Missing NEXT_PUBLIC_CONVEX_URL / NEXT_PUBLIC_CONVEX_SITE_URL. Run `npx convex dev` once, or export CONVEX_URL / CONVEX_SITE_URL.');
  process.exit(1);
}

console.log(`org=${orgCode}\nconvex(query)=${convexUrl}\nconvex(http)=${siteUrl}`);

const client = new ConvexHttpClient(convexUrl);
const recordsRef = makeFunctionReference<'query'>('records:list');
const provenanceRef = makeFunctionReference<'query'>('provenance:list');
const verifyChainRef = makeFunctionReference<'query'>('provenance:verifyChain');

const records = await client.query(recordsRef, {orgCode});
const active = (records as Array<{_id: string; status: string}>).filter((r) => r.status === 'active');
if (active.length < 2) {
  console.error(`Need >=2 active records in ${orgCode}. Seed first: npx convex run seed:seedLocker '{"orgCode":"${orgCode}"}'`);
  process.exit(1);
}
const reviewTarget = active[0]._id;
const dispositionTarget = active[1]._id;
const correlationId = randomUUID();
console.log(`correlationId=${correlationId}`);

// Mint REAL Kinde M2M tokens via the client-credentials grant (each agent's own creds).
const reviewToken = await mintAgentToken('review');
const dispositionToken = await mintAgentToken('disposition');

async function deleteViaEnforcedPath(
  accessToken: string,
  actorAgentId: string,
  recordId: string
): Promise<{status: number; body: string}> {
  const response = await fetch(`${siteUrl.replace(/\/$/, '')}/agent/actions`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${accessToken}`},
    body: JSON.stringify({orgCode, actorAgentId, action: 'records:delete', recordId, correlationId})
  });
  return {status: response.status, body: await response.text()};
}

console.log('\n── Review agent → records:delete  (expect DENY; record stays active) ──');
const reviewResult = await deleteViaEnforcedPath(reviewToken.accessToken, 'review', reviewTarget);
console.log(`HTTP ${reviewResult.status}  ${reviewResult.body}`);

console.log('\n── Disposition agent → records:delete  (expect ALLOW; record deleted) ──');
const dispositionResult = await deleteViaEnforcedPath(dispositionToken.accessToken, 'disposition', dispositionTarget);
console.log(`HTTP ${dispositionResult.status}  ${dispositionResult.body}`);

const provenance = await client.query(provenanceRef, {orgCode});
const chain = await client.query(verifyChainRef, {orgCode});

console.log('\n── provenance rows for this run (correlationId) ──');
for (const row of provenance as Array<Record<string, unknown>>) {
  if (row.correlationId !== correlationId) continue;
  console.log(
    JSON.stringify({
      seq: row.seq,
      decision: row.decision,
      action: row.action,
      actorSub: row.actorSub,
      effectiveScopes: row.effectiveScopes,
      requiredScopes: row.requiredScopes,
      denyReason: row.denyReason,
      prevHash: row.prevHash,
      rowHash: row.rowHash
    })
  );
}

console.log('\n── verifyChain ──');
console.log(JSON.stringify(chain));

console.log(
  '\nConfirm in the Convex dashboard → Data → provenance: the Review row is decision "deny" ' +
    '(its record still active), the Disposition row is decision "allow" (its record deleted), and verifyChain is {ok:true}.'
);
