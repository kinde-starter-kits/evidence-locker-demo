import {defineSchema, defineTable} from 'convex/server';
import {v} from 'convex/values';

// P1 — org-scoped tenancy. Every table carries `orgCode` and every index leads
// with `orgCode`, so no query can cross tenants.
export default defineSchema({
  // The case records agents act on.
  records: defineTable({
    orgCode: v.string(),
    title: v.string(),
    kind: v.string(), // e.g. "case-file"
    status: v.union(v.literal('active'), v.literal('redacted'), v.literal('deleted')),
    createdAt: v.number() // ms epoch
  })
    .index('by_org', ['orgCode'])
    .index('by_org_status', ['orgCode', 'status']),

  // BROKEN-mode plain log: records what happened, NOT who authorized it.
  // Deliberately missing identity/decision/scopes.
  activityLog: defineTable({
    orgCode: v.string(),
    actorAgentId: v.string(),
    action: v.string(), // e.g. "records:delete"
    resourceType: v.string(),
    resourceId: v.string(),
    ts: v.number()
  })
    .index('by_org', ['orgCode'])
    .index('by_org_ts', ['orgCode', 'ts']),

  // ENFORCED-mode authorized-action record. One row per action, OCSF-shaped,
  // hash-chained per org. P1 fixes the shape only — P6 fills prevHash/rowHash
  // and the insert/hashing logic via the component.
  provenance: defineTable({
    orgCode: v.string(),
    seq: v.number(), // per-org monotonic, starts at 0
    correlationId: v.string(), // run/trace id (= OTel/Langfuse traceId later)
    ts: v.number(),
    actorAgentId: v.string(),
    actorSub: v.string(), // the agent M2M sub
    authorityRootKind: v.union(v.literal('user'), v.literal('agent')),
    authorityRootSub: v.string(),
    delegationId: v.string(),
    parentDelegationId: v.optional(v.string()),
    effectiveScopes: v.array(v.string()),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    decision: v.union(v.literal('allow'), v.literal('deny')),
    denyReason: v.optional(v.string()),
    requiredScopes: v.optional(v.array(v.string())),
    prevHash: v.string(), // hex; genesis = 64 zeros
    rowHash: v.string() // hex
  })
    .index('by_org', ['orgCode'])
    .index('by_org_seq', ['orgCode', 'seq'])
    .index('by_org_correlation', ['orgCode', 'correlationId'])
});
