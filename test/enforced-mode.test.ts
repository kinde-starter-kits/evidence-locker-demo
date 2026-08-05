import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from 'vitest';
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
        return new Response(JSON.stringify({jwks_uri: JWKS_URL}), {
          status: 200,
          headers: {'Content-Type': 'application/json'}
        });
      }
      if (url === JWKS_URL) {
        return new Response(JSON.stringify({keys: [publicJwk]}), {
          status: 200,
          headers: {'Content-Type': 'application/json'}
        });
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

// Enforced actor double: bridges the graph's HTTP calls to Convex, injecting the
// right agent's bearer token per actorAgentId (as the Authorization header would).
function enforcedActor(t: Harness, tokens: Record<string, string>) {
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

beforeEach(() => {
  vi.stubEnv('KINDE_DOMAIN', DOMAIN);
  vi.stubEnv('DELEGATION_SIGNING_SECRET', 'test-delegation-secret');
  vi.stubEnv('MODE', 'test');
  vi.stubEnv('AUTHZ_MODE', 'enforced');
  stubKindeEndpoints();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(t: Harness) {
  agentAuthComponent.register(t);
  await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});

  const agentIds: Record<AgentId, string> = {intake: '', review: '', disposition: ''};
  const tokens: Record<string, string> = {};
  for (const agentId of ['review', 'disposition'] as AgentId[]) {
    const clientId = `m2m_${agentId}`;
    agentIds[agentId] = await t.mutation(internal.agentAuth.registerAgent, {
      name: agentId,
      slug: agentId,
      orgCode: 'orgA',
      kindeClientId: clientId,
      allowedTools: ALL_ACTIONS,
      scopes: [...AGENTS[agentId].expectedScopes]
    });
    tokens[agentId] = await mint({
      sub: clientId,
      azp: clientId,
      orgCode: 'orgA',
      scp: [...AGENTS[agentId].expectedScopes]
    });
  }
  return {tokens};
}

describe('P6 enforced mode — authority per action, over-scoped delete denied', () => {
  it('allow (Disposition) and deny (Review) each write ONE provenance row with identity + decision', async () => {
    const t = convexTest(schema, modules);
    const {tokens} = await setup(t);

    const records = await t.query(api.records.list, {orgCode: 'orgA'});
    const reviewTarget = records[0]._id; // Review attempts delete — no delete scope → DENY
    const dispositionTarget = records[1]._id; // Disposition deletes — has delete scope → ALLOW

    await runLockerGraph({
      orgCode: 'orgA',
      client: enforcedActor(t, tokens),
      attempts: {reviewDeletesRecordId: reviewTarget, dispositionDeletesRecordId: dispositionTarget}
    });

    // The over-scoped Review delete was DENIED — the record is untouched.
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: reviewTarget}))?.status).toBe('active');
    // The legitimate Disposition delete was ALLOWED — the record is deleted.
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: dispositionTarget}))?.status).toBe('deleted');

    const prov = await t.query(api.provenance.list, {orgCode: 'orgA'});
    expect(prov).toHaveLength(2);

    const allowRow = prov.find((r) => r.decision === 'allow');
    const denyRow = prov.find((r) => r.decision === 'deny');
    expect(allowRow).toBeDefined();
    expect(denyRow).toBeDefined();
    if (allowRow === undefined || denyRow === undefined) return;

    // ALLOW row: Disposition, delete performed, effective scopes include records:delete.
    expect(allowRow.action).toBe('records:delete');
    expect(allowRow.actorSub).toBe('m2m_disposition');
    expect(allowRow.effectiveScopes).toContain('records:delete');
    expect(allowRow.decision).toBe('allow');

    // DENY row: Review, decision deny, requiredScopes names the missing scope, and
    // its effective scopes do NOT include records:delete.
    expect(denyRow.action).toBe('records:delete');
    expect(denyRow.actorSub).toBe('m2m_review');
    expect(denyRow.decision).toBe('deny');
    expect(denyRow.requiredScopes).toEqual(['records:delete']);
    expect(denyRow.effectiveScopes).not.toContain('records:delete');
    expect(typeof denyRow.denyReason).toBe('string');

    // Unlike P5's activityLog, EACH row carries the authority to judge by.
    for (const row of prov) {
      expect(typeof row.actorSub).toBe('string');
      expect(row.authorityRootKind).toBe('agent');
      expect(Array.isArray(row.effectiveScopes)).toBe(true);
      expect(row.correlationId.length).toBeGreaterThan(0);
    }
  });

  it('the chain is gapless and verifyChain confirms it; tampering is detected at the row', async () => {
    const t = convexTest(schema, modules);
    const {tokens} = await setup(t);
    const records = await t.query(api.records.list, {orgCode: 'orgA'});

    await runLockerGraph({
      orgCode: 'orgA',
      client: enforcedActor(t, tokens),
      attempts: {reviewDeletesRecordId: records[0]._id, dispositionDeletesRecordId: records[1]._id}
    });

    // Gapless seq.
    const prov = await t.query(api.provenance.list, {orgCode: 'orgA'});
    expect(prov.map((r) => r.seq)).toEqual([0, 1]);
    expect(prov[0].prevHash).toBe('0'.repeat(64));
    expect(prov[1].prevHash).toBe(prov[0].rowHash);

    // Clean chain verifies.
    expect(await t.query(api.provenance.verifyChain, {orgCode: 'orgA'})).toEqual({ok: true, length: 2});

    // Tamper with row 0's action → verifyChain reports the break at seq 0.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('provenance')
        .withIndex('by_org_seq', (q) => q.eq('orgCode', 'orgA'))
        .collect();
      await ctx.db.patch(rows[0]._id, {action: 'records:tampered'});
    });
    const broken = await t.query(api.provenance.verifyChain, {orgCode: 'orgA'});
    expect(broken.ok).toBe(false);
    if (broken.ok === false) {
      expect(broken.brokenAtSeq).toBe(0);
    }
  });

  it('stays org-scoped: another tenant has an empty, clean chain', async () => {
    const t = convexTest(schema, modules);
    const {tokens} = await setup(t);
    const records = await t.query(api.records.list, {orgCode: 'orgA'});
    await runLockerGraph({
      orgCode: 'orgA',
      client: enforcedActor(t, tokens),
      attempts: {dispositionDeletesRecordId: records[1]._id}
    });

    expect(await t.query(api.provenance.list, {orgCode: 'orgB'})).toHaveLength(0);
    expect(await t.query(api.provenance.verifyChain, {orgCode: 'orgB'})).toEqual({ok: true, length: 0});
  });
});
