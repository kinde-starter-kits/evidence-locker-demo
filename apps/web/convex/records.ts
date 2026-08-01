import {query, internalMutation} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {v} from 'convex/values';

// Tenant-scoped list. The `by_org` index bounds the query to a single orgCode,
// so it cannot read another tenant's rows.
export const list = query({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    return await ctx.db
      .query('records')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect();
  }
});

// Single record, org-scoped. Returns null if the record's orgCode doesn't match,
// so a caller in one org can never read another org's row (or probe its existence).
export const get = query({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: async (ctx, {orgCode, recordId}) => {
    const record = await ctx.db.get(recordId);
    if (record === null || record.orgCode !== orgCode) {
      return null;
    }
    return record;
  }
});

// Fetch a record and assert it belongs to `orgCode`. Throws the SAME error whether
// the row is missing or owned by another tenant, so mutations never leak existence
// across orgs.
async function requireOwnedRecord(ctx: MutationCtx, orgCode: string, recordId: Id<'records'>) {
  const record = await ctx.db.get(recordId);
  if (record === null || record.orgCode !== orgCode) {
    throw new Error('records: record not found for this org');
  }
  return record;
}

// Internal mutations the P6 action layer will wrap with authorization. Plain
// DB operations for now (no auth), but every read/write is org-scoped.

export const createRecord = internalMutation({
  args: {
    orgCode: v.string(),
    title: v.string(),
    kind: v.string(),
    // Optional so callers/tests can pin it; defaults to now otherwise.
    createdAt: v.optional(v.number())
  },
  handler: async (ctx, {orgCode, title, kind, createdAt}) => {
    return await ctx.db.insert('records', {
      orgCode,
      title,
      kind,
      status: 'active',
      createdAt: createdAt ?? Date.now()
    });
  }
});

export const redactRecord = internalMutation({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: async (ctx, {orgCode, recordId}) => {
    const record = await requireOwnedRecord(ctx, orgCode, recordId);
    await ctx.db.patch(record._id, {status: 'redacted'});
    return record._id;
  }
});

// Export produces a read-only snapshot of the record; it does not change status.
export const exportRecord = internalMutation({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: async (ctx, {orgCode, recordId}) => {
    const record = await requireOwnedRecord(ctx, orgCode, recordId);
    return {
      recordId: record._id,
      orgCode: record.orgCode,
      title: record.title,
      kind: record.kind,
      status: record.status,
      createdAt: record.createdAt
    };
  }
});

// Soft delete: the row stays present with status "deleted" so the audit trail can
// still reference it later. Never a physical row removal.
export const deleteRecord = internalMutation({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: async (ctx, {orgCode, recordId}) => {
    const record = await requireOwnedRecord(ctx, orgCode, recordId);
    await ctx.db.patch(record._id, {status: 'deleted'});
    return record._id;
  }
});
