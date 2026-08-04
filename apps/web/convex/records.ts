import {query, internalMutation} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc, Id} from './_generated/dataModel';
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

// Single record, org-scoped. Returns null if the record's orgCode doesn't match.
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

// ── Shared action logic ─────────────────────────────────────────────────────
// Exported so the action layer (agentActions.performAction) runs the EXACT same
// org-scoped code path per action as the internal mutations below — one path,
// no drift.

// Fetch a record and assert it belongs to `orgCode`. Same error whether missing or
// owned by another tenant, so nothing leaks existence across orgs.
export async function requireOwnedRecord(
  ctx: MutationCtx,
  orgCode: string,
  recordId: Id<'records'>
): Promise<Doc<'records'>> {
  const record = await ctx.db.get(recordId);
  if (record === null || record.orgCode !== orgCode) {
    throw new Error('records: record not found for this org');
  }
  return record;
}

export async function applyCreateRecord(
  ctx: MutationCtx,
  args: {orgCode: string; title: string; kind: string; createdAt?: number}
): Promise<Id<'records'>> {
  return await ctx.db.insert('records', {
    orgCode: args.orgCode,
    title: args.title,
    kind: args.kind,
    status: 'active',
    createdAt: args.createdAt ?? Date.now()
  });
}

export async function applyRedactRecord(
  ctx: MutationCtx,
  orgCode: string,
  recordId: Id<'records'>
): Promise<Id<'records'>> {
  const record = await requireOwnedRecord(ctx, orgCode, recordId);
  await ctx.db.patch(record._id, {status: 'redacted'});
  return record._id;
}

export interface RecordSnapshot {
  recordId: Id<'records'>;
  orgCode: string;
  title: string;
  kind: string;
  status: string;
  createdAt: number;
}

export async function applyExportRecord(
  ctx: MutationCtx,
  orgCode: string,
  recordId: Id<'records'>
): Promise<RecordSnapshot> {
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

// Soft delete: the row stays present with status "deleted" so the audit trail can
// still reference it. Never a physical row removal.
export async function applyDeleteRecord(
  ctx: MutationCtx,
  orgCode: string,
  recordId: Id<'records'>
): Promise<Id<'records'>> {
  const record = await requireOwnedRecord(ctx, orgCode, recordId);
  await ctx.db.patch(record._id, {status: 'deleted'});
  return record._id;
}

// ── Internal mutations (thin wrappers over the shared helpers) ───────────────
// P6 wraps these with authorization; today they are plain org-scoped DB ops.

export const createRecord = internalMutation({
  args: {
    orgCode: v.string(),
    title: v.string(),
    kind: v.string(),
    createdAt: v.optional(v.number())
  },
  handler: (ctx, args) => applyCreateRecord(ctx, args)
});

export const redactRecord = internalMutation({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: (ctx, {orgCode, recordId}) => applyRedactRecord(ctx, orgCode, recordId)
});

export const exportRecord = internalMutation({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: (ctx, {orgCode, recordId}) => applyExportRecord(ctx, orgCode, recordId)
});

export const deleteRecord = internalMutation({
  args: {orgCode: v.string(), recordId: v.id('records')},
  handler: (ctx, {orgCode, recordId}) => applyDeleteRecord(ctx, orgCode, recordId)
});
