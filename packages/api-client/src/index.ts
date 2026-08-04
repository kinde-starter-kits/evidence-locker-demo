// api-client is the ONLY path agents use to reach the app. It talks to the app
// over HTTP with a bearer token and a delegation header. Every method is stubbed
// for P0 — no real work yet — but the surface (and its required inputs) is fixed.

export interface LockerClientOptions {
  /** Bearer token for the agent's Kinde M2M identity. Required — no default. */
  agentToken: string;
  /** HMAC-signed delegation grant scoping what the agent may do. Required — no default. */
  delegation: string;
  /** Base URL of the app's HTTP API. Optional; falls back to same-origin later. */
  baseUrl?: string;
}

export interface EvidenceSummary {
  id: string;
  title: string;
  createdAt: number;
}

// A single run event emitted by an agent. Agents reach the app ONLY over HTTP,
// and this is the shape they POST to the app's ingest endpoint. `seq` and `ts`
// are assigned server-side, so they are not part of the input.
export interface RunEventInput {
  orgCode: string;
  correlationId: string;
  agentId: string;
  type: string;
  payload: unknown;
}

export type RecordAction =
  | 'records:create'
  | 'records:delete'
  | 'records:export'
  | 'records:redact'
  | 'records:annotate';

// What the agent asks the app to do to a record. The agent NEVER states its
// authorization here — in broken mode the app checks nothing; in enforced mode
// (P6) the app derives authority from the verified token/delegation, not this body.
export interface ActionRequest {
  orgCode: string;
  actorAgentId: string;
  action: RecordAction;
  recordId?: string;
  title?: string;
  kind?: string;
}

export interface ActionResult {
  ok: boolean;
  action: RecordAction;
  resourceId: string;
}

export interface LockerClient {
  listEvidence(): Promise<EvidenceSummary[]>;
  getEvidence(id: string): Promise<EvidenceSummary>;
  /** POST a single run event to the app's ingest endpoint. */
  recordEvent(event: RunEventInput): Promise<void>;
  /** Ask the app to perform a record action (the action path). */
  performAction(input: ActionRequest): Promise<ActionResult>;
}

class StubLockerClient implements LockerClient {
  constructor(private readonly options: LockerClientOptions) {}

  listEvidence(): Promise<EvidenceSummary[]> {
    return Promise.reject(this.notImplemented('listEvidence'));
  }

  getEvidence(_id: string): Promise<EvidenceSummary> {
    return Promise.reject(this.notImplemented('getEvidence'));
  }

  // Real HTTP: POST the event to the app's ingest endpoint with the agent's
  // bearer token and delegation. This is the only channel agents have to the app.
  async recordEvent(event: RunEventInput): Promise<void> {
    const {baseUrl, agentToken, delegation} = this.options;
    if (baseUrl === undefined || baseUrl.length === 0) {
      throw new Error('recordEvent: `baseUrl` is required to reach the app over HTTP.');
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/agent/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${agentToken}`,
        'x-delegation': delegation
      },
      body: JSON.stringify(event)
    });
    if (!response.ok) {
      throw new Error(`recordEvent: ingest failed with ${response.status}`);
    }
  }

  // Real HTTP: POST the action to the app's action endpoint. The app decides what
  // to do based on its mode (broken vs enforced) — never on anything the agent
  // claims about its own authority.
  async performAction(input: ActionRequest): Promise<ActionResult> {
    const {baseUrl, agentToken, delegation} = this.options;
    if (baseUrl === undefined || baseUrl.length === 0) {
      throw new Error('performAction: `baseUrl` is required to reach the app over HTTP.');
    }
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/agent/actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${agentToken}`,
        'x-delegation': delegation
      },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error(`performAction: request failed with ${response.status}`);
    }
    return (await response.json()) as ActionResult;
  }

  private notImplemented(method: string): Error {
    const target = this.options.baseUrl ?? 'same-origin';
    return new Error(`@evidence-locker/api-client: ${method}() against ${target} is not implemented yet (P0 stub).`);
  }
}

/**
 * Construct the agent-facing app client. Both `agentToken` and `delegation` are
 * required and have no defaults: an agent with neither identity nor delegation
 * has no business reaching the app.
 */
export function createLockerClient(options: LockerClientOptions): LockerClient {
  if (!options || typeof options.agentToken !== 'string' || options.agentToken.length === 0) {
    throw new Error('createLockerClient: `agentToken` is required.');
  }
  if (typeof options.delegation !== 'string' || options.delegation.length === 0) {
    throw new Error('createLockerClient: `delegation` is required.');
  }
  return new StubLockerClient(options);
}
