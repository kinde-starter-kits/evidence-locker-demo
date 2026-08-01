// Per-agent Kinde M2M identity.
//
// Each agent has its OWN Kinde M2M application (distinct client id + secret), so
// each mints a distinct identity via the client-credentials grant. No convex or
// apps/web import — the boundary holds. No live Kinde call at import time; the
// minter runs only when invoked.

export type AgentId = 'intake' | 'review' | 'disposition';

export interface AgentConfig {
  /** Env var name holding this agent's Kinde M2M client id. */
  envClientId: string;
  /** Env var name holding this agent's Kinde M2M client secret. */
  envClientSecret: string;
  /** The scopes this agent is expected to carry — mirrors the human role it acts for. */
  expectedScopes: readonly string[];
}

// agentId -> credentials + expected scopes. The scope sets mirror the human roles
// in apps/web (Analyst/Reviewer/Custodian); the tests assert they stay aligned.
export const AGENTS: Record<AgentId, AgentConfig> = {
  intake: {
    envClientId: 'INTAKE_CLIENT_ID',
    envClientSecret: 'INTAKE_CLIENT_SECRET',
    expectedScopes: ['records:read', 'records:create']
  },
  review: {
    envClientId: 'REVIEW_CLIENT_ID',
    envClientSecret: 'REVIEW_CLIENT_SECRET',
    expectedScopes: ['records:read', 'records:redact']
  },
  disposition: {
    envClientId: 'DISPOSITION_CLIENT_ID',
    envClientSecret: 'DISPOSITION_CLIENT_SECRET',
    expectedScopes: ['records:read', 'records:dispose']
  }
};

export interface MintedToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`mintAgentToken: missing required env ${name}`);
  }
  return value;
}

/**
 * Request an M2M access token from Kinde for one agent, using that agent's OWN
 * client id/secret and the locker API audience. Required env, no defaults — throws
 * if anything is missing (before any network call is made).
 */
export async function mintAgentToken(agentId: AgentId): Promise<MintedToken> {
  const config = AGENTS[agentId];
  if (config === undefined) {
    throw new Error(`mintAgentToken: unknown agent "${agentId}"`);
  }

  // Resolve every required input first, so a missing credential throws before fetch.
  const tokenUrl = requireEnv('KINDE_M2M_TOKEN_URL');
  const audience = requireEnv('KINDE_M2M_AUDIENCE');
  const clientId = requireEnv(config.envClientId);
  const clientSecret = requireEnv(config.envClientSecret);

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    audience
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body
  });

  if (!response.ok) {
    throw new Error(`mintAgentToken: token request for "${agentId}" failed with ${response.status}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  return {
    accessToken: json.access_token,
    tokenType: json.token_type,
    expiresIn: json.expires_in
  };
}
