import {AgentAuth} from '@kinde-oss/kinde-convex-agent-auth';
import {internalMutation} from './_generated/server';
import {components} from './_generated/api';
import type {FunctionArgs} from 'convex/server';
import {v} from 'convex/values';

// The component client, constructed once from the app's generated component
// reference. The component functions have NO auth of their own — the APP is the
// security boundary. Agent-facing checks go through agentAuth.authorize() only;
// admin-only functions (registerAgent, startInstance, issueDelegation, revoke)
// are wrapped below as INTERNAL mutations so ONLY the app calls them.
export const agentAuth = new AgentAuth(components.agentAuth);

// Recover the exact branded id types the component expects, so wrappers can take
// plain strings from trusted app code and pass them through type-safely.
type StartArgs = FunctionArgs<typeof components.agentAuth.instances.start>;

/**
 * Register an org-scoped M2M agent from a Kinde client_id. INTERNAL admin-only:
 * registering binds a kindeClientId to Convex policy, so it must never be public.
 */
export const registerAgent = internalMutation({
  args: {
    name: v.string(),
    slug: v.string(),
    orgCode: v.string(),
    kindeClientId: v.string(),
    allowedTools: v.array(v.string()),
    scopes: v.array(v.string())
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await agentAuth.registerAgent(ctx, {
      name: args.name,
      slug: args.slug,
      ownerKind: 'org',
      orgCode: args.orgCode,
      kindeClientId: args.kindeClientId,
      kind: 'autonomous',
      allowedTools: args.allowedTools,
      scopes: args.scopes
    });
  }
});

/** Start an instance (a single run) for an agent. INTERNAL admin-only; only ever
 * called after the agent's token has been verified in the action layer. */
export const startInstance = internalMutation({
  args: {
    agentId: v.string(),
    runId: v.string(),
    actingForSubject: v.string(),
    orgCode: v.string(),
    ttlMs: v.optional(v.number())
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    return await agentAuth.startInstance(ctx, {
      agentId: args.agentId as StartArgs['agentId'],
      runId: args.runId,
      actingForSubject: args.actingForSubject,
      orgCode: args.orgCode,
      expiresAt: Date.now() + (args.ttlMs ?? 60 * 60 * 1000)
    });
  }
});

/** The kill switch: revoke an agent so the next authz check denies it. INTERNAL. */
export const revokeAgent = internalMutation({
  args: {agentId: v.string(), reason: v.optional(v.string())},
  returns: v.string(),
  handler: async (ctx, args) => {
    return await agentAuth.revoke(ctx, {
      targetKind: 'agent',
      targetId: args.agentId,
      ...(args.reason === undefined ? {} : {reason: args.reason})
    });
  }
});
