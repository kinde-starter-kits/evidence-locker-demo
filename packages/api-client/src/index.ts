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

export interface LockerClient {
  listEvidence(): Promise<EvidenceSummary[]>;
  getEvidence(id: string): Promise<EvidenceSummary>;
}

class StubLockerClient implements LockerClient {
  constructor(private readonly options: LockerClientOptions) {}

  listEvidence(): Promise<EvidenceSummary[]> {
    return Promise.reject(this.notImplemented('listEvidence'));
  }

  getEvidence(_id: string): Promise<EvidenceSummary> {
    return Promise.reject(this.notImplemented('getEvidence'));
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
