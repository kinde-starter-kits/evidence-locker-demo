import {Mastra} from '@mastra/core/mastra';
import {createWorkflow, createStep} from '@mastra/core/workflows';
import {Observability} from '@mastra/observability';
import {LangfuseExporter} from '@mastra/langfuse';
import {z} from 'zod';
import type {LockerClient, RunEventInput} from '@evidence-locker/api-client';
import type {AgentId} from './identity';

// The three agents run in this fixed order as the Mastra graph.
export const AGENT_SEQUENCE: readonly AgentId[] = ['intake', 'review', 'disposition'];

// Fixed target record. Deterministic — no Date.now / random in recorded data.
const TARGET_REF = 'nw-001';
const TARGET_TITLE = 'Case file: Northwind acquisition';
const TARGET_KIND = 'case-file';

// The graph emits events and, when a delete is attempted, performs an action.
// performAction is optional so event-only runs (P4) can pass a lighter client.
export type EventSink = Pick<LockerClient, 'recordEvent'> & Partial<Pick<LockerClient, 'performAction'>>;

// Which record ids the agents should attempt to delete on this run. Used by the
// P5 broken-mode repro: Review (no delete scope) attempts an unauthorized delete;
// Disposition performs a legitimate one.
export interface DeleteAttempts {
  reviewDeletesRecordId?: string;
  dispositionDeletesRecordId?: string;
}

export interface RunLockerGraphOptions {
  orgCode: string;
  client: EventSink;
  attempts?: DeleteAttempts;
  /**
   * Optional BYOK reasoner for the review step. If provided and it succeeds, its
   * text becomes the annotation; ANY error (or no reasoner) falls back to the
   * deterministic annotation. Production wires this to a Mastra Agent + model when
   * an LLM key is present; the deterministic default needs no key.
   */
  reasoner?: (input: {title: string; kind: string}) => Promise<string>;
  /**
   * Optional pre-built observability. If provided it is used as-is (the caller
   * then owns flush/shutdown); otherwise it is built from LANGFUSE_* env when the
   * keys are present.
   */
  observability?: Observability;
}

export interface LangfuseSettings {
  publicKey: string;
  secretKey: string;
  /** Region host, e.g. https://us.cloud.langfuse.com. Defaults to the SDK default (EU). */
  baseUrl?: string;
}

// Build the Langfuse observability instance and hand back the exporter too, so a
// caller can flush/shutdown it explicitly and inspect its client.
export function buildLangfuseObservability(settings: LangfuseSettings): {
  observability: Observability;
  exporter: LangfuseExporter;
} {
  const exporter = new LangfuseExporter({
    publicKey: settings.publicKey,
    secretKey: settings.secretKey,
    baseUrl: settings.baseUrl,
    realtime: true
  });
  const observability = new Observability({
    configs: {
      langfuse: {
        serviceName: 'evidence-locker-agents',
        exporters: [exporter]
      }
    }
  });
  return {observability, exporter};
}

export interface RunLockerGraphResult {
  correlationId: string;
  events: RunEventInput[];
}

// Build observability from LANGFUSE_* env ONLY when keys are present. Tracing is
// optional: with no keys the graph runs normally and nothing is registered.
function buildObservabilityFromEnv(): Observability | undefined {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    return undefined;
  }
  return buildLangfuseObservability({
    publicKey,
    secretKey,
    baseUrl: process.env.LANGFUSE_BASE_URL
  }).observability;
}

async function annotate(
  input: {title: string; kind: string},
  reasoner: RunLockerGraphOptions['reasoner']
): Promise<string> {
  const deterministic = `Reviewed "${input.title}" (${input.kind}); no anomalies found.`;
  if (!reasoner) {
    return deterministic;
  }
  try {
    const text = await reasoner(input);
    return text.trim().length > 0 ? text : deterministic;
  } catch {
    // Falls back to deterministic on ANY error.
    return deterministic;
  }
}

/**
 * Run the three-agent Mastra graph on the deterministic path. Every event carries
 * the run's correlationId (= the Mastra run id), so the Langfuse trace and the
 * Convex events share one id. Emits via the injected client and returns the
 * correlationId plus the ordered events it emitted.
 */
export async function runLockerGraph(opts: RunLockerGraphOptions): Promise<RunLockerGraphResult> {
  const {orgCode, client, reasoner, attempts} = opts;
  const events: RunEventInput[] = [];

  const ctxSchema = z.object({orgCode: z.string(), correlationId: z.string()});

  async function emit(correlationId: string, agentId: AgentId, type: string, payload: unknown): Promise<void> {
    const event: RunEventInput = {orgCode, correlationId, agentId, type, payload};
    events.push(event);
    await client.recordEvent(event);
  }

  // An agent asks the app to delete a record over HTTP (never touching Convex).
  // Whether that agent is ALLOWED to is the app's business — in broken mode it
  // isn't checked, which is exactly what the repro exposes.
  async function attemptDelete(correlationId: string, agentId: AgentId, recordId: string): Promise<void> {
    await emit(correlationId, agentId, 'record.delete.attempt', {recordId});
    if (client.performAction) {
      const result = await client.performAction({
        orgCode,
        actorAgentId: agentId,
        action: 'records:delete',
        recordId
      });
      await emit(correlationId, agentId, 'record.deleted', {recordId, ok: result.ok});
    }
  }

  const intakeStep = createStep({
    id: 'intake',
    inputSchema: ctxSchema,
    outputSchema: ctxSchema,
    execute: async ({inputData}) => {
      await emit(inputData.correlationId, 'intake', 'agent.started', {});
      await emit(inputData.correlationId, 'intake', 'record.created', {
        ref: TARGET_REF,
        title: TARGET_TITLE,
        kind: TARGET_KIND
      });
      return inputData;
    }
  });

  const reviewStep = createStep({
    id: 'review',
    inputSchema: ctxSchema,
    outputSchema: ctxSchema,
    execute: async ({inputData}) => {
      await emit(inputData.correlationId, 'review', 'agent.started', {});
      const annotation = await annotate({title: TARGET_TITLE, kind: TARGET_KIND}, reasoner);
      await emit(inputData.correlationId, 'review', 'record.reviewed', {ref: TARGET_REF, annotation});
      // Review's scopes are records:read + records:annotate — NOT records:delete.
      // In broken mode this unauthorized delete still succeeds.
      if (attempts?.reviewDeletesRecordId !== undefined) {
        await attemptDelete(inputData.correlationId, 'review', attempts.reviewDeletesRecordId);
      }
      return inputData;
    }
  });

  const dispositionStep = createStep({
    id: 'disposition',
    inputSchema: ctxSchema,
    outputSchema: ctxSchema,
    execute: async ({inputData}) => {
      await emit(inputData.correlationId, 'disposition', 'agent.started', {});
      await emit(inputData.correlationId, 'disposition', 'record.redacted', {ref: TARGET_REF});
      await emit(inputData.correlationId, 'disposition', 'record.exported', {ref: TARGET_REF, format: 'pdf'});
      // Disposition holds records:delete — this delete is legitimate. In broken
      // mode it looks IDENTICAL to Review's unauthorized one in activityLog.
      if (attempts?.dispositionDeletesRecordId !== undefined) {
        await attemptDelete(inputData.correlationId, 'disposition', attempts.dispositionDeletesRecordId);
      }
      return inputData;
    }
  });

  const workflow = createWorkflow({
    id: 'locker',
    inputSchema: ctxSchema,
    outputSchema: ctxSchema
  })
    .then(intakeStep)
    .then(reviewStep)
    .then(dispositionStep)
    .commit();

  const mastra = new Mastra({
    workflows: {locker: workflow},
    observability: opts.observability ?? buildObservabilityFromEnv(),
    // Deterministic demo path uses the default in-memory run store; disable the
    // logger so that expected "no storage configured" notice doesn't clutter output.
    logger: false
  });

  const run = await mastra.getWorkflow('locker').createRun();
  const correlationId = run.runId;
  await run.start({inputData: {orgCode, correlationId}});

  return {correlationId, events};
}
