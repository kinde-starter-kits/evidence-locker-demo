import {query, internalQuery, mutation} from './_generated/server';
import type {QueryCtx} from './_generated/server';
import {v} from 'convex/values';

export type AuthzMode = 'broken' | 'enforced';

/**
 * Resolve the app's authorization mode SERVER-SIDE.
 *
 * Precedence: the persisted global override (the demoSettings singleton, set by the
 * on-page demo control) wins; otherwise the Convex DEPLOYMENT env `AUTHZ_MODE`;
 * otherwise "broken". It never reads anything request-scoped — no header, body, or
 * query param — so a request can never choose its own mode. The toggle changes this
 * ONE global value; the action path always reads the resolved global mode.
 */
export async function resolveAuthzMode(ctx: QueryCtx): Promise<AuthzMode> {
  const row = await ctx.db.query('demoSettings').first();
  if (row !== null) {
    return row.authzMode;
  }
  return process.env.AUTHZ_MODE === 'enforced' ? 'enforced' : 'broken';
}

// Internal read for the action/HTTP layers (actions have no ctx.db, so they call
// this via ctx.runQuery).
export const readAuthzMode = internalQuery({
  args: {},
  handler: async (ctx): Promise<AuthzMode> => resolveAuthzMode(ctx)
});

// Public read for the UI banner — reflects the true server mode (env + override).
export const getMode = query({
  args: {},
  handler: async (ctx): Promise<AuthzMode> => resolveAuthzMode(ctx)
});

/**
 * Demo admin control: flip the ONE global server mode. This does NOT let a request
 * choose the mode for its own action — the action path reads the resolved global
 * mode, never this argument. It is the in-app equivalent of `npx convex env set
 * AUTHZ_MODE …`. In production this mutation would be wrapped with admin auth.
 */
export const setMode = mutation({
  args: {mode: v.union(v.literal('broken'), v.literal('enforced'))},
  handler: async (ctx, {mode}): Promise<AuthzMode> => {
    const row = await ctx.db.query('demoSettings').first();
    if (row === null) {
      await ctx.db.insert('demoSettings', {authzMode: mode});
    } else {
      await ctx.db.patch(row._id, {authzMode: mode});
    }
    return mode;
  }
});
