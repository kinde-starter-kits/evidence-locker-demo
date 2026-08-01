import {httpRouter} from 'convex/server';
import {httpAction} from './_generated/server';
import {internal} from './_generated/api';

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

const http = httpRouter();
http.route({path: '/agent/events', method: 'POST', handler: ingestRunEvents});

export default http;
