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

// Distinct runs for a tenant (for the replay picker), newest activity first.
export const listRuns = query({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    const events = await ctx.db
      .query('runEvents')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect();
    const runs = new Map<string, {correlationId: string; startedAt: number; lastAt: number; count: number}>();
    for (const event of events) {
      const existing = runs.get(event.correlationId);
      if (existing === undefined) {
        runs.set(event.correlationId, {
          correlationId: event.correlationId,
          startedAt: event.ts,
          lastAt: event.ts,
          count: 1
        });
      } else {
        existing.count += 1;
        existing.startedAt = Math.min(existing.startedAt, event.ts);
        existing.lastAt = Math.max(existing.lastAt, event.ts);
      }
    }
    return Array.from(runs.values()).sort((a, b) => b.lastAt - a.lastAt);
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
