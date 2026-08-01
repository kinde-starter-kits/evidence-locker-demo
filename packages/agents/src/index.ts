// Mastra agents for Evidence Locker.
//
// Boundary rule (enforced by scripts/check-boundaries.mjs and CI): nothing in this
// package may import `convex`, `apps/web`, or any `_generated` code. The ONLY way an
// agent reaches the app is through @evidence-locker/api-client (HTTP + bearer token).
//
// P0: stub agents only. Real Mastra wiring (@mastra/core) lands in a later phase.

import {createLockerClient, type LockerClient} from '@evidence-locker/api-client';

export interface AgentCredentials {
  agentToken: string;
  delegation: string;
}

export interface StubAgent {
  readonly name: string;
  /** The app client this agent uses — the only channel it has to the app. */
  readonly client: LockerClient;
}

/**
 * The intake agent (stub). It is handed a scoped app client and nothing else;
 * it has no access to Convex or the app internals.
 */
export function createIntakeAgent(credentials: AgentCredentials): StubAgent {
  return {
    name: 'intake',
    client: createLockerClient({
      agentToken: credentials.agentToken,
      delegation: credentials.delegation
    })
  };
}

export const agents = {
  createIntakeAgent
};
