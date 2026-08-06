import {internalMutation} from './_generated/server';
import {v} from 'convex/values';

// Deterministic seed. Same ids-by-content, titles, kinds, and timestamps on every
// run — no Date.now(), no random. Stable base timestamp: 2025-01-01T00:00:00Z.
const SEED_BASE_TS = 1_735_689_600_000;
const MINUTE = 60_000;

type Classification = 'public' | 'confidential' | 'privileged' | 'pii';

interface SeedRecord {
  title: string;
  kind: string;
  classification: Classification;
  offsetMs: number;
}

// A fixed set of named (fictional) legal evidence documents, all seeded active.
// Classification gives the redaction angle meaning: Disposition redacts
// privileged/PII documents before export.
const SEED_RECORDS: readonly SeedRecord[] = [
  {
    title: 'Halvorsen v. Meridian Logistics — deposition transcript',
    kind: 'deposition-transcript',
    classification: 'confidential',
    offsetMs: 0 * MINUTE
  },
  {
    title: 'Project Cormorant — internal strategy memo (privileged)',
    kind: 'strategy-memo',
    classification: 'privileged',
    offsetMs: 1 * MINUTE
  },
  {
    title: 'Vendor contract — Northwind Freight',
    kind: 'contract',
    classification: 'confidential',
    offsetMs: 2 * MINUTE
  },
  {
    title: 'Whistleblower complaint — HR intake (PII)',
    kind: 'hr-intake',
    classification: 'pii',
    offsetMs: 3 * MINUTE
  },
  {
    title: 'Incident report — warehouse #7',
    kind: 'incident-report',
    classification: 'public',
    offsetMs: 4 * MINUTE
  },
  {
    title: 'Executive email export (privileged)',
    kind: 'email-export',
    classification: 'privileged',
    offsetMs: 5 * MINUTE
  }
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
        classification: record.classification,
        status: 'active',
        createdAt: SEED_BASE_TS + record.offsetMs
      });
    }

    return SEED_RECORDS.length;
  }
});
