import {describe, it, expect, afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../apps/web/convex/schema';
import {api, internal} from '../apps/web/convex/_generated/api';
import {runLockerGraph, AGENTS} from '@evidence-locker/agents';
import type {RunEventInput, ActionRequest, ActionResult} from '@evidence-locker/api-client';

const modules = import.meta.glob('../apps/web/convex/**/*.*s');
type Harness = ReturnType<typeof convexTest>;

// Client double: bridges the graph's HTTP calls to the Convex functions, exactly
// as the live httpActions do (minus the network hop).
function actor(t: Harness) {
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
      return await t.mutation(internal.agentActions.performAction, {
        orgCode: input.orgCode,
        actorAgentId: input.actorAgentId,
        action: input.action,
        recordId: input.recordId,
        title: input.title,
        kind: input.kind
      });
    }
  };
}

// Build a plain object without the given keys (no unused-var destructuring).
function omit(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
}

// Fields that WOULD record authority — none of them exist in broken mode.
const AUTHORITY_FIELDS = [
  'decision',
  'scopes',
  'effectiveScopes',
  'requiredScopes',
  'delegationId',
  'parentDelegationId',
  'authorityRootKind',
  'authorityRootSub',
  'denyReason'
];

afterEach(() => {
  delete process.env.AUTHZ_MODE;
});

describe('P5 broken mode — the audit gap', () => {
  it('unauthorized (Review) and legitimate (Disposition) deletes are indistinguishable in activityLog', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});
    const records = await t.query(api.records.list, {orgCode: 'orgA'});
    const reviewTarget = records[0]._id; // Review deletes this — UNAUTHORIZED (no delete scope)
    const dispositionTarget = records[1]._id; // Disposition deletes this — LEGITIMATE

    // Broken mode is the default (AUTHZ_MODE unset).
    delete process.env.AUTHZ_MODE;
    const {events} = await runLockerGraph({
      orgCode: 'orgA',
      client: actor(t),
      attempts: {reviewDeletesRecordId: reviewTarget, dispositionDeletesRecordId: dispositionTarget}
    });

    // Both deletes SUCCEEDED — nothing checked the acting agent's scopes.
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: reviewTarget}))?.status).toBe('deleted');
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: dispositionTarget}))?.status).toBe('deleted');
    expect(events.some((e) => e.agentId === 'review' && e.type === 'record.deleted')).toBe(true);
    expect(events.some((e) => e.agentId === 'disposition' && e.type === 'record.deleted')).toBe(true);

    // Exactly two records:delete rows in the blind log.
    const log = await t.query(api.activityLog.list, {orgCode: 'orgA'});
    const deletes = log.filter((r) => r.action === 'records:delete');
    expect(deletes).toHaveLength(2);

    const byAgent = Object.fromEntries(deletes.map((r) => [r.actorAgentId, r]));
    const reviewRow = byAgent['review'];
    const dispoRow = byAgent['disposition'];
    expect(reviewRow).toBeDefined();
    expect(dispoRow).toBeDefined();

    // Each row carries ONLY the blind fields — nothing about authority.
    const BLIND_KEYS = ['_id', '_creationTime', 'orgCode', 'actorAgentId', 'action', 'resourceType', 'resourceId', 'ts'].sort();
    expect(Object.keys(reviewRow).sort()).toEqual(BLIND_KEYS);
    expect(Object.keys(dispoRow).sort()).toEqual(BLIND_KEYS);
    for (const field of AUTHORITY_FIELDS) {
      expect(reviewRow).not.toHaveProperty(field);
      expect(dispoRow).not.toHaveProperty(field);
    }

    // Strip actorAgentId (and the incidental id/ts/resourceId) → the two rows are
    // byte-identical. Given only activityLog you CANNOT tell the unauthorized delete
    // from the authorized one.
    const incidental = ['_id', '_creationTime', 'ts', 'resourceId', 'actorAgentId'];
    expect(omit(reviewRow, incidental)).toEqual(omit(dispoRow, incidental));
    expect(omit(reviewRow, incidental)).toEqual({
      orgCode: 'orgA',
      action: 'records:delete',
      resourceType: 'records'
    });

    // The gap made explicit: Review LACKS records:delete, Disposition HAS it — yet
    // neither row carries any field to judge that by.
    expect(AGENTS.review.expectedScopes).not.toContain('records:delete');
    expect(AGENTS.disposition.expectedScopes).toContain('records:delete');

    // Stays org-scoped: another tenant sees none of it.
    expect(await t.query(api.activityLog.list, {orgCode: 'orgB'})).toHaveLength(0);
  });

  it('AUTHZ_MODE is read server-side; a request claiming a different mode is ignored', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});
    const active = await t.query(api.records.list, {orgCode: 'orgA'});
    const target = active[0]._id;

    // Env unset → broken. The request BODY/HEADER claims "enforced" — it must be ignored.
    delete process.env.AUTHZ_MODE;
    const res = await t.fetch('/agent/actions', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-authz-mode': 'enforced'},
      body: JSON.stringify({
        orgCode: 'orgA',
        actorAgentId: 'review',
        action: 'records:delete',
        recordId: target,
        mode: 'enforced' // ignored — mode is server-side only
      })
    });
    expect(res.status).toBe(200);
    // Broken behavior happened despite the claim: the record was deleted.
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: target}))?.status).toBe('deleted');

    // Now flip the SERVER env to enforced → the same shape of request fails closed.
    process.env.AUTHZ_MODE = 'enforced';
    const stillActive = (await t.query(api.records.list, {orgCode: 'orgA'})).filter((r) => r.status === 'active');
    const target2 = stillActive[0]._id;
    const res2 = await t.fetch('/agent/actions', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({orgCode: 'orgA', actorAgentId: 'disposition', action: 'records:delete', recordId: target2})
    });
    expect(res2.status).toBe(400); // enforced mode fails closed until P6
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: target2}))?.status).toBe('active');
  });
});
