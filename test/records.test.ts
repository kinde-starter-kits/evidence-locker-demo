import {describe, it, expect} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../apps/web/convex/schema';
import {api, internal} from '../apps/web/convex/_generated/api';

const modules = import.meta.glob('../apps/web/convex/**/*.*s');

function harness() {
  return convexTest(schema, modules);
}

interface RecordRow {
  title: string;
  kind: string;
  status: string;
  createdAt: number;
}

// Compare records by content (ignoring _id/_creationTime), stably ordered.
function contentOf(rows: RecordRow[]) {
  return rows
    .map((r) => ({title: r.title, kind: r.kind, status: r.status, createdAt: r.createdAt}))
    .sort((a, b) => a.createdAt - b.createdAt);
}

describe('records store + deterministic seed', () => {
  it('seeds a fixed set that is identical on a second run (idempotent)', async () => {
    const t = harness();

    const count1 = await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});
    const first = await t.query(api.records.list, {orgCode: 'orgA'});

    const count2 = await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});
    const second = await t.query(api.records.list, {orgCode: 'orgA'});

    expect(count1).toBe(count2);
    expect(first.length).toBeGreaterThanOrEqual(6);
    expect(first).toHaveLength(second.length);
    expect(contentOf(first)).toEqual(contentOf(second));
    expect(first.every((r) => r.status === 'active')).toBe(true);
    // Deterministic timestamps: no Date.now() drift between runs.
    expect(contentOf(first)[0].createdAt).toBe(1_735_689_600_000);
  });

  it('get() returns the record for the right org and null for a mismatched org', async () => {
    const t = harness();
    await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});
    const [row] = await t.query(api.records.list, {orgCode: 'orgA'});

    const hit = await t.query(api.records.get, {orgCode: 'orgA', recordId: row._id});
    expect(hit?._id).toEqual(row._id);

    const miss = await t.query(api.records.get, {orgCode: 'orgB', recordId: row._id});
    expect(miss).toBeNull();
  });

  it('create -> redact -> delete moves status correctly; delete is soft', async () => {
    const t = harness();

    const recordId = await t.mutation(internal.records.createRecord, {
      orgCode: 'orgA',
      title: 'Fresh intake',
      kind: 'case-file'
    });
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId}))?.status).toBe('active');

    await t.mutation(internal.records.redactRecord, {orgCode: 'orgA', recordId});
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId}))?.status).toBe('redacted');

    await t.mutation(internal.records.deleteRecord, {orgCode: 'orgA', recordId});
    const afterDelete = await t.query(api.records.get, {orgCode: 'orgA', recordId});
    // Soft delete: row still present, status "deleted".
    expect(afterDelete).not.toBeNull();
    expect(afterDelete?.status).toBe('deleted');
  });

  it('cross-tenant probe: orgB cannot read or mutate orgA records', async () => {
    const t = harness();
    await t.mutation(internal.seed.seedLocker, {orgCode: 'orgA'});
    const [row] = await t.query(api.records.list, {orgCode: 'orgA'});

    // Read is denied (null).
    expect(await t.query(api.records.get, {orgCode: 'orgB', recordId: row._id})).toBeNull();

    // Mutations from the wrong org throw and change nothing.
    await expect(
      t.mutation(internal.records.redactRecord, {orgCode: 'orgB', recordId: row._id})
    ).rejects.toThrow();
    await expect(
      t.mutation(internal.records.deleteRecord, {orgCode: 'orgB', recordId: row._id})
    ).rejects.toThrow();
    await expect(
      t.mutation(internal.records.exportRecord, {orgCode: 'orgB', recordId: row._id})
    ).rejects.toThrow();

    // orgA's record is untouched.
    expect((await t.query(api.records.get, {orgCode: 'orgA', recordId: row._id}))?.status).toBe('active');

    // orgB has no records of its own.
    expect(await t.query(api.records.list, {orgCode: 'orgB'})).toHaveLength(0);
  });
});
