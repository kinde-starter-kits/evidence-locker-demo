import {defineSchema, defineTable} from 'convex/server';
import {v} from 'convex/values';

// Minimal schema so `convex codegen` emits `_generated`. No app logic yet.
export default defineSchema({
  evidence: defineTable({
    title: v.string(),
    createdAt: v.number()
  })
});
