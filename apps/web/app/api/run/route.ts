import {ConvexHttpClient} from 'convex/browser';
import {api} from '../../../convex/_generated/api';
import {runLockerGraph, mintAgentToken, type AgentId} from '@evidence-locker/agents';
import type {RunEventInput, ActionRequest, ActionResult} from '@evidence-locker/api-client';

// Kick a fresh agent run server-side. The graph reaches Convex ONLY over HTTP
// (/agent/events, /agent/actions) — the same path an external agent uses — so the
// run streams into the UI live. The run's mode is whatever the server AUTHZ_MODE
// is; this route never chooses it.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {orgCode?: string};
  const orgCode = body.orgCode;
  if (typeof orgCode !== 'string' || orgCode.length === 0) {
    return Response.json({error: 'orgCode is required'}, {status: 400});
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (convexUrl === undefined || siteUrl === undefined) {
    return Response.json({error: 'NEXT_PUBLIC_CONVEX_URL / NEXT_PUBLIC_CONVEX_SITE_URL not set'}, {status: 500});
  }

  const client = new ConvexHttpClient(convexUrl);
  const records = await client.query(api.records.list, {orgCode});
  const active = records.filter((r) => r.status === 'active');
  if (active.length < 2) {
    return Response.json(
      {error: `Seed the org first: npx convex run seed:seedLocker '{"orgCode":"${orgCode}"}'`},
      {status: 400}
    );
  }

  const base = siteUrl.replace(/\/$/, '');
  const actor = {
    async recordEvent(event: RunEventInput): Promise<void> {
      await fetch(`${base}/agent/events`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(event)
      });
    },
    async performAction(input: ActionRequest): Promise<ActionResult> {
      // Enforced mode needs a real per-agent token; broken mode ignores it. If M2M
      // creds aren't configured in this server, we POST without a token (fine for
      // broken mode; enforced will 401 that action and record nothing).
      let token: string | undefined;
      try {
        token = (await mintAgentToken(input.actorAgentId as AgentId)).accessToken;
      } catch {
        token = undefined;
      }
      const response = await fetch(`${base}/agent/actions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : {authorization: `Bearer ${token}`})
        },
        body: JSON.stringify(input)
      });
      return (await response.json()) as ActionResult;
    }
  };

  const {correlationId} = await runLockerGraph({
    orgCode,
    client: actor,
    attempts: {
      reviewDeletesRecordId: active[0]._id,
      dispositionDeletesRecordId: active[1]._id
    }
  });

  return Response.json({correlationId});
}
