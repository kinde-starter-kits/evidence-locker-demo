// End-to-end narrative — the whole story off a single seed, asserted, in BOTH
// modes. Runs fully in-process via convex-test (no deployment, no live Kinde),
// using the same jose-minted token + registered-agent doubles as the P6 tests.
// Mode is set through the REAL server-side path (demoSettings / resolveAuthzMode),
// never a per-request flag.
//
//   npm run e2e
//
// Runs under vitest (convex-test needs Vite's import.meta.glob for the module map
// and the component's register()). Prints each beat and asserts each outcome;
// vitest exits non-zero if any assertion fails.
import {test, expect, beforeAll, vi} from 'vitest';
import {convexTest} from 'convex-test';
import {SignJWT, exportJWK, generateKeyPair} from 'jose';
import type {JWK} from 'jose';
import schema from '../apps/web/convex/schema';
import {api, internal} from '../apps/web/convex/_generated/api';
import agentAuthComponent from '@kinde-oss/kinde-convex-agent-auth/test';
import {runLockerGraph, AGENTS, type AgentId} from '@evidence-locker/agents';
import type {RunEventInput, ActionRequest, ActionResult} from '@evidence-locker/api-client';

const modules = import.meta.glob('../apps/web/convex/**/*.*s');
type Harness = ReturnType<typeof convexTest>;

const ORG = 'org_demo';
const DOMAIN = 'acme.kinde.com';
const ISSUER = `https://${DOMAIN}`;
const CONFIG_URL = `https://${DOMAIN}/.well-known/openid-configuration`;
const JWKS_URL = `https://${DOMAIN}/.well-known/jwks`;

// Every record action is an allowed tool; the granted SCOPES decide allow vs deny.
const ALL_ACTIONS = [
  'records:read',
  'records:create',
  'records:annotate',
  'records:redact',
  'records:export',
  'records:delete'
];

// Authority fields that would tell allowed from denied — NONE exist on activityLog.
const AUTHORITY_FIELDS = [
  'decision',
  'scopes',
  'effectiveScopes',
  'requiredScopes',
  'delegationId',
  'authorityRootKind',
  'authorityRootSub',
  'denyReason'
];

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: SigningKey;
let publicJwk: Record<string, string | string[]>;

function toJwkRecord(jwk: JWK, kid: string): Record<string, string | string[]> {
  const record: Record<string, string | string[]> = {kid, alg: 'RS256', use: 'sig'};
  for (const [member, value] of Object.entries(jwk)) {
    if (typeof value === 'string') {
      record[member] = value;
    } else if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) {
      record[member] = value;
    }
  }
  return record;
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', {extractable: true});
  signingKey = pair.privateKey;
  publicJwk = toJwkRecord(await exportJWK(pair.publicKey), 'key-main');
});

function stubKindeEndpoints() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === CONFIG_URL) {
        return new Response(JSON.stringify({jwks_uri: JWKS_URL}), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      if (url === JWKS_URL) {
        return new Response(JSON.stringify({keys: [publicJwk]}), {status: 200, headers: {'Content-Type': 'application/json'}});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    })
  );
}

async function mint(options: {sub: string; azp: string; orgCode: string; scp: string[]}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({gty: 'client_credentials', azp: options.azp, org_code: options.orgCode, scp: options.scp})
    .setProtectedHeader({alg: 'RS256', kid: 'key-main'})
    .setIssuedAt(now - 60)
    .setIssuer(ISSUER)
    .setSubject(options.sub)
    .setExpirationTime(now + 3600)
    .sign(signingKey);
}

// Client double: bridges the graph's HTTP calls to Convex, injecting each agent's
// token (used in enforced mode; ignored in broken mode).
function actor(t: Harness, tokens: Record<string, string>) {
  return {
    async recordEvent(event: RunEventInput): Promise<void> {
      await t.mutation(internal.runEvents.ingest, {
        orgCode: event.orgCode,
        correlationId: event.correlationId,
        agentId: event.agentId,
        type: event.type,
        payload: event.payload
      });
    },
    async performAction(input: ActionRequest): Promise<ActionResult> {
      return await t.action(internal.agentActions.performAction, {
        orgCode: input.orgCode,
        actorAgentId: input.actorAgentId,
        action: input.action,
        correlationId: input.correlationId,
        recordId: input.recordId,
        token: tokens[input.actorAgentId]
      });
    }
  };
}

function omit(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

function beat(message: string): void {
  console.log(`\n▸ ${message}`);
}
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}

test('evidence locker — end-to-end narrative (both modes)', async () => {
  // Env the component needs to VERIFY tokens. The MODE is NOT set here — the demo's
  // authorization mode comes from demoSettings via setMode (the real server path).
  vi.stubEnv('KINDE_DOMAIN', DOMAIN);
  vi.stubEnv('DELEGATION_SIGNING_SECRET', 'test-delegation-secret');
  vi.stubEnv('MODE', 'test');
  stubKindeEndpoints();

  const t = convexTest(schema, modules);
  agentAuthComponent.register(t);

  // ── Beat 1 — Seed ─────────────────────────────────────────────────────────
  beat('Beat 1 — Seed one org with named legal case files');
  await t.mutation(internal.seed.seedLocker, {orgCode: ORG});
  const files = await t.query(api.records.list, {orgCode: ORG});
  expect(files.length).toBeGreaterThanOrEqual(6);
  ok(`seeded ${files.length} case files (e.g. "${files[0].title}")`);

  // Register the two agents (admin) and mint their real (test) M2M tokens.
  const tokens: Record<string, string> = {};
  for (const agentId of ['review', 'disposition'] as AgentId[]) {
    const clientId = `m2m_${agentId}`;
    await t.mutation(internal.agentAuth.registerAgent, {
      name: agentId,
      slug: agentId,
      orgCode: ORG,
      kindeClientId: clientId,
      allowedTools: ALL_ACTIONS,
      scopes: [...AGENTS[agentId].expectedScopes]
    });
    tokens[agentId] = await mint({sub: clientId, azp: clientId, orgCode: ORG, scp: [...AGENTS[agentId].expectedScopes]});
  }

  // ── Beat 2 — BROKEN mode ──────────────────────────────────────────────────
  beat('Beat 2 — BROKEN mode: run the agents');
  await t.mutation(api.authzMode.setMode, {mode: 'broken'});
  expect(await t.query(api.authzMode.getMode)).toBe('broken');
  ok('mode set to broken via demoSettings (server-side, not a per-request flag)');

  const brokenFiles = (await t.query(api.records.list, {orgCode: ORG})).filter((r) => r.status === 'active');
  await runLockerGraph({
    orgCode: ORG,
    client: actor(t, tokens),
    attempts: {reviewDeletesRecordId: brokenFiles[0]._id, dispositionDeletesRecordId: brokenFiles[1]._id}
  });

  const log = await t.query(api.activityLog.list, {orgCode: ORG});
  const brokenDeletes = log.filter((r) => r.action === 'records:delete');
  expect(brokenDeletes).toHaveLength(2);
  ok('activityLog recorded 2 delete actions (review + disposition)');

  for (const row of brokenDeletes) {
    for (const field of AUTHORITY_FIELDS) {
      expect(row).not.toHaveProperty(field);
    }
  }
  const strip = (row: Record<string, unknown>) => omit(row, ['_id', '_creationTime', 'ts', 'resourceId', 'actorAgentId']);
  expect(strip(brokenDeletes[0])).toEqual(strip(brokenDeletes[1]));
  ok('the two deletes are INDISTINGUISHABLE on authority — no field records who was allowed');

  expect(await t.query(api.provenance.list, {orgCode: ORG})).toHaveLength(0);
  ok('provenance has NO rows in broken mode');

  // ── Beat 3 — ENFORCED mode ────────────────────────────────────────────────
  beat('Beat 3 — ENFORCED mode: run the agents');
  await t.mutation(api.authzMode.setMode, {mode: 'enforced'});
  expect(await t.query(api.authzMode.getMode)).toBe('enforced');
  ok('mode set to enforced via demoSettings');

  const enforcedFiles = (await t.query(api.records.list, {orgCode: ORG})).filter((r) => r.status === 'active');
  const reviewTarget = enforcedFiles[0];
  const dispositionTarget = enforcedFiles[1];
  await runLockerGraph({
    orgCode: ORG,
    client: actor(t, tokens),
    attempts: {reviewDeletesRecordId: reviewTarget._id, dispositionDeletesRecordId: dispositionTarget._id}
  });

  const prov = await t.query(api.provenance.list, {orgCode: ORG});
  const denyRow = prov.find((r) => r.decision === 'deny');
  const allowRow = prov.find((r) => r.decision === 'allow');
  expect(denyRow).toBeDefined();
  expect(allowRow).toBeDefined();
  if (denyRow === undefined || allowRow === undefined) return;

  expect(denyRow.action).toBe('records:delete');
  expect(denyRow.denyReason).toBe('insufficient_scope');
  expect(denyRow.requiredScopes).toEqual(['records:delete']);
  expect((await t.query(api.records.get, {orgCode: ORG, recordId: reviewTarget._id}))?.status).toBe('active');
  ok(`Review delete DENIED (insufficient_scope, needed records:delete) — "${reviewTarget.title}" survives`);

  expect(allowRow.action).toBe('records:delete');
  expect(allowRow.effectiveScopes).toContain('records:delete');
  expect((await t.query(api.records.get, {orgCode: ORG, recordId: dispositionTarget._id}))?.status).toBe('deleted');
  ok('Disposition delete ALLOWED — record performed');

  expect(prov).toHaveLength(2);
  ok('each action wrote one provenance row (identity + effectiveScopes + decision)');

  expect(await t.query(api.provenance.verifyChain, {orgCode: ORG})).toEqual({ok: true, length: 2});
  ok('verifyChain passes — gapless seq, rowHash chain intact');

  // ── Beat 4 — TAMPER ───────────────────────────────────────────────────────
  beat('Beat 4 — TAMPER one provenance row, then re-verify');
  await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('provenance')
      .withIndex('by_org_seq', (q) => q.eq('orgCode', ORG))
      .collect();
    await ctx.db.patch(rows[0]._id, {action: 'records:tampered'});
  });
  const tampered = await t.query(api.provenance.verifyChain, {orgCode: ORG});
  expect(tampered.ok).toBe(false);
  const brokenAt = tampered.ok === false ? tampered.brokenAtSeq : -1;
  expect(brokenAt).toBe(0);
  ok(`verifyChain now reports the break at seq ${brokenAt} — tamper-evident`);

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(
    '\nNARRATIVE OK — broken mode hides the unauthorized delete; enforced denies it,' +
      ' records the authority, and proves the record was not tampered with.'
  );
});
