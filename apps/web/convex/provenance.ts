// Provenance: the replayable, hash-chained AUTHORITY record.
//
// HONEST SPLIT — two stores, different owners (do not blur):
//   • The vendored kinde-convex-agent-auth component keeps its OWN append-only
//     audit of every decision (read via components.agentAuth.audit.query). That
//     store is the component's.
//   • THIS `provenance` table is OURS: one row per authorized action that we build
//     from each AuthorizeResult { caller, decision }, hash-chained per org so the
//     authority trail is independently replayable and tamper-evident.
//
// Contrast with P5's activityLog: that blind log records what happened, not who
// authorized it. These rows record identity + delegation + effective scopes +
// decision, and the chain proves the sequence was not altered after the fact.

import {query} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import {v} from 'convex/values';
import canonicalize from 'canonicalize';

const GENESIS = '0'.repeat(64);

// The row fields EXCEPT the chain metadata that append() assigns (seq/prevHash/rowHash).
export interface ProvenanceInput {
  orgCode: string;
  correlationId: string;
  ts: number;
  actorAgentId: string;
  actorSub: string;
  authorityRootKind: 'user' | 'agent';
  authorityRootSub: string;
  delegationId: string;
  parentDelegationId?: string;
  effectiveScopes: string[];
  action: string;
  resourceType: string;
  resourceId: string;
  decision: 'allow' | 'deny';
  denyReason?: string;
  requiredScopes?: string[];
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// rowHash = SHA-256( JCS(rowBody) + prevHash ). rowBody is every stored field
// EXCEPT rowHash (so it includes seq and prevHash). RFC 8785 canonicalization via
// `canonicalize` — never JSON.stringify (key order / formatting would not be stable).
async function computeRowHash(rowBody: Record<string, unknown>, prevHash: string): Promise<string> {
  const canonical = canonicalize(rowBody);
  if (canonical === undefined) {
    throw new Error('provenance: canonicalization failed');
  }
  return await sha256Hex(canonical + prevHash);
}

/**
 * Append one hash-chained provenance row. `seq` and `prevHash` are read from the
 * last row for this org INSIDE this mutation, so the chain is gapless and ordered
 * even under concurrent writes (the mutation is transactional).
 */
export async function appendProvenanceRow(
  ctx: MutationCtx,
  input: ProvenanceInput
): Promise<{seq: number; rowHash: string}> {
  const last = await ctx.db
    .query('provenance')
    .withIndex('by_org_seq', (q) => q.eq('orgCode', input.orgCode))
    .order('desc')
    .first();
  const seq = last === null ? 0 : last.seq + 1;
  const prevHash = last === null ? GENESIS : last.rowHash;

  // The stored row body (everything except rowHash). Optional fields are only
  // present when set, so verifyChain reconstructs the exact same body.
  const rowBody = {
    orgCode: input.orgCode,
    seq,
    correlationId: input.correlationId,
    ts: input.ts,
    actorAgentId: input.actorAgentId,
    actorSub: input.actorSub,
    authorityRootKind: input.authorityRootKind,
    authorityRootSub: input.authorityRootSub,
    delegationId: input.delegationId,
    ...(input.parentDelegationId === undefined ? {} : {parentDelegationId: input.parentDelegationId}),
    effectiveScopes: input.effectiveScopes,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    decision: input.decision,
    ...(input.denyReason === undefined ? {} : {denyReason: input.denyReason}),
    ...(input.requiredScopes === undefined ? {} : {requiredScopes: input.requiredScopes}),
    prevHash
  };

  const rowHash = await computeRowHash(rowBody as unknown as Record<string, unknown>, prevHash);
  await ctx.db.insert('provenance', {...rowBody, rowHash});
  return {seq, rowHash};
}

type VerifyChainResult =
  | {ok: true; length: number}
  | {ok: false; brokenAtSeq: number; reason: string};

/**
 * Recompute the org's provenance chain and report the first break (or clean).
 * This is what the CI structural assert and the P7 "verify integrity" button call.
 */
export const verifyChain = query({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}): Promise<VerifyChainResult> => {
    const rows = await ctx.db
      .query('provenance')
      .withIndex('by_org_seq', (q) => q.eq('orgCode', orgCode))
      .order('asc')
      .collect();

    let prev = GENESIS;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.seq !== i) {
        return {ok: false, brokenAtSeq: row.seq, reason: `seq_gap (expected ${i})`};
      }
      if (row.prevHash !== prev) {
        return {ok: false, brokenAtSeq: row.seq, reason: 'prev_hash_mismatch'};
      }
      const rowBody: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === '_id' || key === '_creationTime' || key === 'rowHash') continue;
        rowBody[key] = value;
      }
      const recomputed = await computeRowHash(rowBody, prev);
      if (recomputed !== row.rowHash) {
        return {ok: false, brokenAtSeq: row.seq, reason: 'row_hash_mismatch'};
      }
      prev = row.rowHash;
    }
    return {ok: true, length: rows.length};
  }
});

// Tenant-scoped read of the authority trail, ordered by seq.
export const list = query({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    const rows = await ctx.db
      .query('provenance')
      .withIndex('by_org_seq', (q) => q.eq('orgCode', orgCode))
      .order('asc')
      .collect();
    return rows;
  }
});
