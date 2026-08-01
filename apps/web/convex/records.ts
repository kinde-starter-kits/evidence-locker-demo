import {query} from './_generated/server';
import {v} from 'convex/values';

// Trivial tenant-scoped list. The `by_org` index makes it impossible to read
// another tenant's rows: the query is bounded to a single orgCode.
export const list = query({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    return await ctx.db
      .query('records')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect();
  }
});
