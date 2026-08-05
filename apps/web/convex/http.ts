import {httpRouter} from 'convex/server';
import {httpAction} from './_generated/server';
import {internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {getAuthzMode} from './authzMode';

// HTTP ingest for agent run events. Agents (packages/agents) reach the app ONLY
// over HTTP — never by importing Convex — and this is where their events land.
// Unauthenticated for now; P6 wraps it with the Kinde agent-auth component
// (verify the bearer token, bind the caller's org). It already enforces orgCode
// on write: the event is stored under the orgCode in the body, nothing else.
const ingestRunEvents = httpAction(async (ctx, request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid json', {status: 400});
  }

  if (typeof body !== 'object' || body === null) {
    return new Response('invalid body', {status: 400});
  }

  const {orgCode, correlationId, agentId, type, payload} = body as Record<string, unknown>;
  if (
    typeof orgCode !== 'string' ||
    typeof correlationId !== 'string' ||
    typeof agentId !== 'string' ||
    typeof type !== 'string'
  ) {
    return new Response('missing or invalid fields', {status: 400});
  }

  const seq = await ctx.runMutation(internal.runEvents.ingest, {
    orgCode,
    correlationId,
    agentId,
    type,
    payload: payload ?? {}
  });

  return new Response(JSON.stringify({ok: true, seq}), {
    status: 200,
    headers: {'content-type': 'application/json'}
  });
});

// HTTP action path. The agent asks the app to perform a record action. In BROKEN
// mode the mutation performs it with no identity/scope check and writes a blind
// activityLog row. NOTE: the mode is NEVER read from this request — not from the
// body, a header, or a query param. It comes only from the deployment env
// (getAuthzMode), so `mode` in the body below is deliberately never looked at.
const performAction = httpAction(async (ctx, request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('invalid json', {status: 400});
  }

  if (typeof body !== 'object' || body === null) {
    return new Response('invalid body', {status: 400});
  }

  const {orgCode, actorAgentId, action, recordId, title, kind, correlationId} = body as Record<string, unknown>;
  if (typeof orgCode !== 'string' || typeof actorAgentId !== 'string' || typeof action !== 'string') {
    return new Response('missing or invalid fields', {status: 400});
  }

  // The agent's bearer token comes from the Authorization header (enforced mode
  // verifies it). It is NEVER read from the body.
  const authHeader = request.headers.get('authorization') ?? '';
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : undefined;

  try {
    const result = await ctx.runAction(internal.agentActions.performAction, {
      orgCode,
      actorAgentId,
      action: action as 'records:create' | 'records:delete' | 'records:export' | 'records:redact' | 'records:annotate',
      recordId: typeof recordId === 'string' ? (recordId as Id<'records'>) : undefined,
      title: typeof title === 'string' ? title : undefined,
      kind: typeof kind === 'string' ? kind : undefined,
      correlationId: typeof correlationId === 'string' ? correlationId : undefined,
      token
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {'content-type': 'application/json'}
    });
  } catch (error) {
    // In enforced mode a thrown error means token verification failed → 401.
    // In broken mode it is a bad request → 400. (A DENY is not thrown — it returns 200.)
    const status = getAuthzMode() === 'enforced' ? 401 : 400;
    return new Response(JSON.stringify({ok: false, error: String(error)}), {
      status,
      headers: {'content-type': 'application/json'}
    });
  }
});

const http = httpRouter();
http.route({path: '/agent/events', method: 'POST', handler: ingestRunEvents});
http.route({path: '/agent/actions', method: 'POST', handler: performAction});

export default http;
