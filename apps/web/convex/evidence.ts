import {query} from './_generated/server';

// One trivial query — enough to exercise codegen. No real logic yet.
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('evidence').collect();
  }
});
