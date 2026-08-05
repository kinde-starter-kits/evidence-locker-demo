import {defineApp} from 'convex/server';
import {v} from 'convex/values';
import agentAuth from '@kinde-oss/kinde-convex-agent-auth/convex.config.js';

// Wire the vendored Kinde agent-auth component into the app and pass its env
// through. These are CONVEX DEPLOYMENT env vars (npx convex env set …), never web
// process env. KINDE_AUDIENCE is required in live mode (test mode may omit it).
const app = defineApp({
  env: {
    KINDE_DOMAIN: v.string(),
    KINDE_AUDIENCE: v.optional(v.string()),
    DELEGATION_SIGNING_SECRET: v.string()
  }
});

app.use(agentAuth, {
  env: {
    KINDE_DOMAIN: app.env.KINDE_DOMAIN,
    KINDE_AUDIENCE: app.env.KINDE_AUDIENCE,
    DELEGATION_SIGNING_SECRET: app.env.DELEGATION_SIGNING_SECRET
  }
});

export default app;
