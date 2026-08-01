import {describe, it, expect} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../apps/web/convex/schema';
import {api, internal} from '../apps/web/convex/_generated/api';
import {runLockerGraph, AGENT_SEQUENCE} from '@evidence-locker/agents';
import type {RunEventInput} from '@evidence-locker/api-client';

const modules = import.meta.glob('../apps/web/convex/**/*.*s');

type Harness = ReturnType<typeof convexTest>;

// A client double that bridges the graph's HTTP recordEvent to the Convex ingest
// mutation — exactly what the live httpAction does, minus the network hop.
function ingestClient(t: Harness) {
  return {
    async recordEvent(event: RunEventInput): Promise<void> {
      await t.mutation(internal.runEvents.ingest, {
        orgCode: event.orgCode,
        correlationId: event.correlationId,
        agentId: event.agentId,
        type: event.type,
        payload: event.payload
      });
    }
  };
}

const EXPECTED_ORDER = [
  'intake:agent.started',
  'intake:record.created',
  'review:agent.started',
  'review:record.reviewed',
  'disposition:agent.started',
  'disposition:record.redacted',
  'disposition:record.exported'
];

function contentOf(events: RunEventInput[]) {
  return events.map((e) => ({orgCode: e.orgCode, agentId: e.agentId, type: e.type, payload: e.payload}));
}

describe('P4 Mastra graph -> Convex runEvents', () => {
  it('a full deterministic run emits the expected ordered events, all sharing correlationId, org-scoped', async () => {
    const t = convexTest(schema, modules);
    const {correlationId, events} = await runLockerGraph({orgCode: 'orgA', client: ingestClient(t)});

    // correlationId present and non-empty on the run and every emitted event.
    expect(correlationId).toBeTruthy();
    expect(correlationId.length).toBeGreaterThan(0);
    expect(events.every((e) => e.correlationId === correlationId)).toBe(true);
    expect(events.every((e) => e.orgCode === 'orgA')).toBe(true);
    expect(AGENT_SEQUENCE).toEqual(['intake', 'review', 'disposition']);

    // Expected ordered (agentId:type) sequence.
    expect(events.map((e) => `${e.agentId}:${e.type}`)).toEqual(EXPECTED_ORDER);

    // The events landed in Convex under orgA, seq 0..N in order.
    const stored = await t.query(api.runEvents.listRunEvents, {orgCode: 'orgA', correlationId});
    expect(stored).toHaveLength(events.length);
    expect(stored.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(stored.map((e) => `${e.agentId}:${e.type}`)).toEqual(EXPECTED_ORDER);
    expect(stored.every((e) => e.orgCode === 'orgA')).toBe(true);

    // Nothing leaked into another tenant for this run.
    expect(await t.query(api.runEvents.listRunEvents, {orgCode: 'orgB', correlationId})).toHaveLength(0);
  });

  it('re-running yields identical event content (determinism), ignoring the per-run correlationId', async () => {
    const t = convexTest(schema, modules);
    const run1 = await runLockerGraph({orgCode: 'orgA', client: ingestClient(t)});
    const run2 = await runLockerGraph({orgCode: 'orgA', client: ingestClient(t)});

    expect(contentOf(run1.events)).toEqual(contentOf(run2.events));
    // correlationIds differ per run — they are the Mastra run ids.
    expect(run1.correlationId).not.toEqual(run2.correlationId);
  });

  it('ingest enforces orgCode: an event tagged orgB cannot land under orgA', async () => {
    const t = convexTest(schema, modules);
    const correlationId = 'run-xyz';

    await t.mutation(internal.runEvents.ingest, {
      orgCode: 'orgB',
      correlationId,
      agentId: 'intake',
      type: 'agent.started',
      payload: {}
    });

    expect(await t.query(api.runEvents.listRunEvents, {orgCode: 'orgA', correlationId})).toHaveLength(0);
    const bEvents = await t.query(api.runEvents.listRunEvents, {orgCode: 'orgB', correlationId});
    expect(bEvents).toHaveLength(1);
    expect(bEvents[0].orgCode).toBe('orgB');
    expect(bEvents[0].seq).toBe(0);
  });
});
