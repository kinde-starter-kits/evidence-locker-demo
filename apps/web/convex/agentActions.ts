import {internalMutation} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {v} from 'convex/values';
import {getAuthzMode} from './authzMode';
import {applyCreateRecord, applyRedactRecord, applyExportRecord, applyDeleteRecord} from './records';

const recordAction = v.union(
  v.literal('records:create'),
  v.literal('records:delete'),
  v.literal('records:export'),
  v.literal('records:redact'),
  v.literal('records:annotate')
);

function requireRecordId(recordId: Id<'records'> | undefined): Id<'records'> {
  if (recordId === undefined) {
    throw new Error('agentActions: this action requires a recordId');
  }
  return recordId;
}

/**
 * The agent action path. In BROKEN mode it performs the requested action based on
 * NOTHING but the request — no identity check, no scope check — and writes a single
 * deliberately-blind activityLog row: what happened, NOT who authorized it. There is
 * no `mode` argument here; the mode comes only from getAuthzMode() (deployment env),
 * so a request can never choose it.
 */
export const performAction = internalMutation({
  args: {
    orgCode: v.string(),
    actorAgentId: v.string(),
    action: recordAction,
    recordId: v.optional(v.id('records')),
    title: v.optional(v.string()),
    kind: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const mode = getAuthzMode();
    if (mode !== 'broken') {
      // Enforcement is the P6 Kinde agent-auth component. Fail closed until then.
      throw new Error('performAction: enforced mode requires the P6 authorization component');
    }

    // BROKEN MODE: whoever asks, gets it. No authority is consulted or recorded.
    const {orgCode, actorAgentId, action} = args;
    let resourceId: Id<'records'>;

    switch (action) {
      case 'records:create': {
        if (args.title === undefined || args.kind === undefined) {
          throw new Error('records:create requires title and kind');
        }
        resourceId = await applyCreateRecord(ctx, {orgCode, title: args.title, kind: args.kind});
        break;
      }
      case 'records:delete': {
        resourceId = await applyDeleteRecord(ctx, orgCode, requireRecordId(args.recordId));
        break;
      }
      case 'records:redact': {
        resourceId = await applyRedactRecord(ctx, orgCode, requireRecordId(args.recordId));
        break;
      }
      case 'records:export': {
        const snapshot = await applyExportRecord(ctx, orgCode, requireRecordId(args.recordId));
        resourceId = snapshot.recordId;
        break;
      }
      case 'records:annotate': {
        // Non-destructive metadata action; nothing to persist in P3's record schema.
        resourceId = requireRecordId(args.recordId);
        break;
      }
    }

    // The deliberately-blind log. It captures WHAT happened, not WHO authorized it:
    // no authority, no decision, no scopes, no delegation. An unauthorized delete is
    // byte-identical in shape to a legitimate one — the whole point of broken mode.
    await ctx.db.insert('activityLog', {
      orgCode,
      actorAgentId,
      action,
      resourceType: 'records',
      resourceId,
      ts: Date.now()
    });

    return {ok: true, action, resourceId};
  }
});
