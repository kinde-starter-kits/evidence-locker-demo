import {internalMutation, internalAction} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {components, internal} from './_generated/api';
import {v} from 'convex/values';
import type {FunctionArgs} from 'convex/server';
import {agentAuth} from './agentAuth';
import {appendProvenanceRow} from './provenance';
import {applyCreateRecord, applyRedactRecord, applyExportRecord, applyDeleteRecord} from './records';

type CanArgs = FunctionArgs<typeof components.agentAuth.authz.can>;

const recordAction = v.union(
  v.literal('records:create'),
  v.literal('records:delete'),
  v.literal('records:export'),
  v.literal('records:redact'),
  v.literal('records:annotate')
);

type RecordAction =
  | 'records:create'
  | 'records:delete'
  | 'records:export'
  | 'records:redact'
  | 'records:annotate';

// Explicit outcome type — also breaks the self-referential inference cycle in the
// performAction action (whose handler references `internal.agentActions`).
interface ActionOutcome {
  ok: boolean;
  action: string;
  resourceId: string;
  decision: string;
}

function requireRecordId(recordId: Id<'records'> | undefined): Id<'records'> {
  if (recordId === undefined) {
    throw new Error('agentActions: this action requires a recordId');
  }
  return recordId;
}

// Perform the record action itself (allow path only) via the shared apply* helpers.
async function applyAction(
  ctx: MutationCtx,
  orgCode: string,
  action: RecordAction,
  recordId: Id<'records'> | undefined,
  title: string | undefined,
  kind: string | undefined
): Promise<Id<'records'>> {
  switch (action) {
    case 'records:create': {
      if (title === undefined || kind === undefined) {
        throw new Error('records:create requires title and kind');
      }
      return await applyCreateRecord(ctx, {orgCode, title, kind});
    }
    case 'records:delete':
      return await applyDeleteRecord(ctx, orgCode, requireRecordId(recordId));
    case 'records:redact':
      return await applyRedactRecord(ctx, orgCode, requireRecordId(recordId));
    case 'records:export':
      return (await applyExportRecord(ctx, orgCode, requireRecordId(recordId))).recordId;
    case 'records:annotate':
      return requireRecordId(recordId);
  }
}

// ── BROKEN mode: the blind log (unchanged from P5) ──────────────────────────
export const performBroken = internalMutation({
  args: {
    orgCode: v.string(),
    actorAgentId: v.string(),
    action: recordAction,
    recordId: v.optional(v.id('records')),
    title: v.optional(v.string()),
    kind: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const resourceId = await applyAction(ctx, args.orgCode, args.action, args.recordId, args.title, args.kind);
    // The deliberately-blind row: WHAT happened, not WHO authorized it.
    await ctx.db.insert('activityLog', {
      orgCode: args.orgCode,
      actorAgentId: args.actorAgentId,
      action: args.action,
      resourceType: 'records',
      resourceId,
      ts: Date.now()
    });
    return {ok: true, action: args.action, resourceId, decision: 'performed' as const};
  }
});

// ── ENFORCED mode: apply (only on allow) + write ONE provenance row ─────────
export const commitEnforcedDecision = internalMutation({
  args: {
    orgCode: v.string(),
    correlationId: v.string(),
    actorAgentId: v.string(),
    actorSub: v.string(),
    authorityRootKind: v.union(v.literal('user'), v.literal('agent')),
    authorityRootSub: v.string(),
    delegationId: v.string(),
    effectiveScopes: v.array(v.string()),
    action: recordAction,
    allowed: v.boolean(),
    denyReason: v.optional(v.string()),
    requiredScopes: v.optional(v.array(v.string())),
    recordId: v.optional(v.id('records')),
    title: v.optional(v.string()),
    kind: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    // Perform the action ONLY on allow. On deny, nothing is performed.
    const resourceId: string = args.allowed
      ? await applyAction(ctx, args.orgCode, args.action, args.recordId, args.title, args.kind)
      : (args.recordId ?? '');

    await appendProvenanceRow(ctx, {
      orgCode: args.orgCode,
      correlationId: args.correlationId,
      ts: Date.now(),
      actorAgentId: args.actorAgentId,
      actorSub: args.actorSub,
      authorityRootKind: args.authorityRootKind,
      authorityRootSub: args.authorityRootSub,
      delegationId: args.delegationId,
      effectiveScopes: args.effectiveScopes,
      action: args.action,
      resourceType: 'records',
      resourceId,
      decision: args.allowed ? 'allow' : 'deny',
      ...(args.denyReason === undefined ? {} : {denyReason: args.denyReason}),
      ...(args.requiredScopes === undefined ? {} : {requiredScopes: args.requiredScopes})
    });

    return {ok: args.allowed, action: args.action, resourceId, decision: args.allowed ? 'allow' : 'deny'};
  }
});

/**
 * The single action entry point. Broken mode writes the blind activityLog row.
 * Enforced mode verifies the agent's token, starts the run instance, authorizes
 * through the component, and writes one hash-chained provenance row (allow OR
 * deny). The mode comes ONLY from getAuthzMode() — never from this request.
 */
export const performAction = internalAction({
  args: {
    orgCode: v.string(),
    actorAgentId: v.string(),
    action: recordAction,
    recordId: v.optional(v.id('records')),
    title: v.optional(v.string()),
    kind: v.optional(v.string()),
    correlationId: v.optional(v.string()),
    token: v.optional(v.string()),
    actingForSubject: v.optional(v.string())
  },
  handler: async (ctx, args): Promise<ActionOutcome> => {
    // Mode is resolved server-side from the global setting/env — never this request.
    const mode = await ctx.runQuery(internal.authzMode.readAuthzMode);
    if (mode === 'broken') {
      return await ctx.runMutation(internal.agentActions.performBroken, {
        orgCode: args.orgCode,
        actorAgentId: args.actorAgentId,
        action: args.action,
        recordId: args.recordId,
        title: args.title,
        kind: args.kind
      });
    }

    // ENFORCED. An invalid/missing token THROWS (401-style). A denial does NOT
    // throw — it is returned as decision.allowed === false and recorded.
    if (args.token === undefined || args.token.length === 0) {
      throw new Error('enforced: missing bearer token');
    }
    if (args.correlationId === undefined || args.correlationId.length === 0) {
      throw new Error('enforced: missing correlationId');
    }

    // 1. Verify the token to resolve the registered agent (throws if invalid).
    const verified = await agentAuth.verifyCaller(ctx, args.token, {expectedOrgCode: args.orgCode});
    if (verified.agentId === null) {
      throw new Error('enforced: token maps to no registered agent');
    }

    // 2. Start the run instance, only after token verification. The instance runId
    //    is derived from our correlationId, but made unique per agent so multiple
    //    agents acting within one run each get their OWN instance (the component
    //    binds a caller to an instance). Admin-only wrapper — app calls it.
    const instanceId = await ctx.runMutation(internal.agentAuth.startInstance, {
      agentId: verified.agentId,
      runId: `${args.correlationId}:${verified.agentId}`,
      actingForSubject: args.actingForSubject ?? verified.subject,
      orgCode: args.orgCode
    });

    // 3. Authorize this action for the instance — authorize() (never authz.can)
    //    threads the verified caller in, so the decision is bound to this agent.
    const {caller, decision} = await agentAuth.authorize(ctx, args.token, {
      instanceId: instanceId as CanArgs['instanceId'],
      action: args.action,
      enforceTokenScopes: true,
      requireOrgCode: true,
      ...(args.recordId === undefined ? {} : {resource: args.recordId})
    });

    // 4/5. Commit: apply on allow, then write ONE provenance row (allow or deny).
    return await ctx.runMutation(internal.agentActions.commitEnforcedDecision, {
      orgCode: args.orgCode,
      correlationId: args.correlationId,
      actorAgentId: caller.agentId ?? args.actorAgentId,
      actorSub: caller.subject,
      // No user delegation is issued in this path: the agent acts on its own M2M
      // authority. (delegations.issue would set authorityRootKind:"user".)
      authorityRootKind: 'agent',
      authorityRootSub: caller.subject,
      delegationId: '',
      effectiveScopes: caller.scopes,
      action: args.action,
      allowed: decision.allowed,
      ...(decision.allowed ? {} : {denyReason: decision.reason}),
      ...(decision.requiredScopes === undefined ? {} : {requiredScopes: decision.requiredScopes}),
      recordId: args.recordId,
      title: args.title,
      kind: args.kind
    });
  }
});
