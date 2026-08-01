import {query, internalMutation} from './_generated/server';
import {v} from 'convex/values';

// Ingest a single run event. seq is assigned server-side (per-run monotonic) so
// it can't be spoofed, and the event is written under the provided orgCode only —
// a caller cannot land an event under another tenant. P6 will additionally verify
// the caller's identity/org before this runs.
export const ingest = internalMutation({
  args: {
    orgCode: v.string(),
    correlationId: v.string(),
    agentId: v.string(),
    type: v.string(),
    payload: v.any()
  },
  handler: async (ctx, {orgCode, correlationId, agentId, type, payload}) => {
    const existing = await ctx.db
      .query('runEvents')
      .withIndex('by_org_correlation', (q) => q.eq('orgCode', orgCode).eq('correlationId', correlationId))
      .collect();
    const seq = existing.length;

    await ctx.db.insert('runEvents', {
      orgCode,
      correlationId,
      seq,
      ts: Date.now(),
      agentId,
      type,
      payload
    });

    return seq;
  }
});

// Tenant-scoped read of one run's event stream, ordered by seq.
export const listRunEvents = query({
  args: {orgCode: v.string(), correlationId: v.string()},
  handler: async (ctx, {orgCode, correlationId}) => {
    const events = await ctx.db
      .query('runEvents')
      .withIndex('by_org_correlation', (q) => q.eq('orgCode', orgCode).eq('correlationId', correlationId))
      .collect();
    return events.sort((a, b) => a.seq - b.seq);
  }
});
