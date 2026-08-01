import {query} from './_generated/server';
import {v} from 'convex/values';

// Trivial tenant-scoped list, bounded to a single orgCode via the `by_org` index.
export const list = query({
  args: {orgCode: v.string()},
  handler: async (ctx, {orgCode}) => {
    return await ctx.db
      .query('provenance')
      .withIndex('by_org', (q) => q.eq('orgCode', orgCode))
      .collect();
  }
});
