import {describe, it, expect} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../apps/web/convex/schema';
import {api} from '../apps/web/convex/_generated/api';

// convex-test needs the function module map. This glob spans the whole convex dir
// (including `_generated`, which convex-test uses to locate the module root), so the
// suite runs entirely in-process — no deployment, CI-safe.
const modules = import.meta.glob('../apps/web/convex/**/*.*s');

function newHarness() {
  return convexTest(schema, modules);
}

describe('org tenancy — no query crosses tenants', () => {
  it('records: orgA sees only its 2 rows, orgB only its 1', async () => {
    const t = newHarness();
    await t.run(async (ctx) => {
      await ctx.db.insert('records', {orgCode: 'orgA', title: 'A-1', kind: 'case-file', status: 'active', createdAt: 1});
      await ctx.db.insert('records', {orgCode: 'orgA', title: 'A-2', kind: 'case-file', status: 'redacted', createdAt: 2});
      await ctx.db.insert('records', {orgCode: 'orgB', title: 'B-1', kind: 'case-file', status: 'active', createdAt: 3});
    });

    const a = await t.query(api.records.list, {orgCode: 'orgA'});
    const b = await t.query(api.records.list, {orgCode: 'orgB'});

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(a.map((r) => r.title).sort()).toEqual(['A-1', 'A-2']);
    expect(b.map((r) => r.title)).toEqual(['B-1']);
    expect(a.every((r) => r.orgCode === 'orgA')).toBe(true);
    expect(b.every((r) => r.orgCode === 'orgB')).toBe(true);
  });

  it('activityLog: orgA sees only its 2 rows, orgB only its 1', async () => {
    const t = newHarness();
    await t.run(async (ctx) => {
      await ctx.db.insert('activityLog', {orgCode: 'orgA', actorAgentId: 'agent-a', action: 'records:read', resourceType: 'records', resourceId: 'r1', ts: 1});
      await ctx.db.insert('activityLog', {orgCode: 'orgA', actorAgentId: 'agent-a', action: 'records:delete', resourceType: 'records', resourceId: 'r2', ts: 2});
      await ctx.db.insert('activityLog', {orgCode: 'orgB', actorAgentId: 'agent-b', action: 'records:read', resourceType: 'records', resourceId: 'r3', ts: 3});
    });

    const a = await t.query(api.activityLog.list, {orgCode: 'orgA'});
    const b = await t.query(api.activityLog.list, {orgCode: 'orgB'});

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(a.every((row) => row.orgCode === 'orgA')).toBe(true);
    expect(b.every((row) => row.orgCode === 'orgB')).toBe(true);
  });

  it('provenance: orgA sees only its 2 rows, orgB only its 1', async () => {
    const t = newHarness();
    await t.run(async (ctx) => {
      await ctx.db.insert('provenance', {
        orgCode: 'orgA',
        seq: 0,
        correlationId: 'trace-a',
        ts: 1,
        actorAgentId: 'agent-a',
        actorSub: 'sub-a',
        authorityRootKind: 'user',
        authorityRootSub: 'user-a',
        delegationId: 'del-a1',
        effectiveScopes: ['records:read'],
        action: 'records:read',
        resourceType: 'records',
        resourceId: 'r1',
        decision: 'allow',
        prevHash: '0'.repeat(64),
        rowHash: 'a'.repeat(64)
      });
      await ctx.db.insert('provenance', {
        orgCode: 'orgA',
        seq: 1,
        correlationId: 'trace-a',
        ts: 2,
        actorAgentId: 'agent-a',
        actorSub: 'sub-a',
        authorityRootKind: 'agent',
        authorityRootSub: 'agent-a',
        delegationId: 'del-a2',
        parentDelegationId: 'del-a1',
        effectiveScopes: [],
        action: 'records:delete',
        resourceType: 'records',
        resourceId: 'r2',
        decision: 'deny',
        denyReason: 'scope_wall',
        requiredScopes: ['records:delete'],
        prevHash: 'a'.repeat(64),
        rowHash: 'b'.repeat(64)
      });
      await ctx.db.insert('provenance', {
        orgCode: 'orgB',
        seq: 0,
        correlationId: 'trace-b',
        ts: 3,
        actorAgentId: 'agent-b',
        actorSub: 'sub-b',
        authorityRootKind: 'user',
        authorityRootSub: 'user-b',
        delegationId: 'del-b1',
        effectiveScopes: ['records:read'],
        action: 'records:read',
        resourceType: 'records',
        resourceId: 'r3',
        decision: 'allow',
        prevHash: '0'.repeat(64),
        rowHash: 'c'.repeat(64)
      });
    });

    const a = await t.query(api.provenance.list, {orgCode: 'orgA'});
    const b = await t.query(api.provenance.list, {orgCode: 'orgB'});

    expect(a).toHaveLength(2);
    expect(b).toHaveLength(1);
    expect(a.every((row) => row.orgCode === 'orgA')).toBe(true);
    expect(b.every((row) => row.orgCode === 'orgB')).toBe(true);
    // The other tenant's correlationId is never visible.
    expect(a.some((row) => row.correlationId === 'trace-b')).toBe(false);
  });
});
