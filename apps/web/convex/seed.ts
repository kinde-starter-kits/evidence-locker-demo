import {internalMutation} from './_generated/server';
import {v} from 'convex/values';

// Deterministic seed. Same ids-by-content, titles, kinds, and timestamps on every
// run — no Date.now(), no random. Stable base timestamp: 2025-01-01T00:00:00Z.
const SEED_BASE_TS = 1_735_689_600_000;
const MINUTE = 60_000;

interface SeedRecord {
  title: string;
  kind: string;
  offsetMs: number;
}

// A fixed set of case records, mixed kinds, all seeded as status "active".
const SEED_RECORDS: readonly SeedRecord[] = [
  {title: 'Case file: Northwind acquisition', kind: 'case-file', offsetMs: 0 * MINUTE},
  {title: 'Deposition transcript: J. Rivera', kind: 'transcript', offsetMs: 1 * MINUTE},
  {title: 'Evidence photo: warehouse dock', kind: 'photo', offsetMs: 2 * MINUTE},
  {title: 'Chain-of-custody log: exhibit 14', kind: 'custody-log', offsetMs: 3 * MINUTE},
  {title: 'Contract: master services agreement', kind: 'contract', offsetMs: 4 * MINUTE},
  {title: 'Email export: Q3 negotiations', kind: 'email-export', offsetMs: 5 * MINUTE},
  {title: 'Case file: Contoso settlement', kind: 'case-file', offsetMs: 6 * MINUTE}
];

/**
 * Reset one org's records to the fixed seed set. Idempotent: clears this org's
 * rows, then inserts the same content every run. Only touches the passed orgCode.
 */
export const seedLocker = internalMutation({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    // Clear only this tenant's records (a fixture reset — physical delete).
    const existing = await ctx.db
      .query('records')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    // Insert the fixed set.
    for (const record of SEED_RECORDS) {
      await ctx.db.insert('records', {
        orgCode,
        title: record.title,
        kind: record.kind,
        status: 'active',
        createdAt: SEED_BASE_TS + record.offsetMs
      });
    }

    return SEED_RECORDS.length;
  }
});
