import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {AGENTS, mintAgentToken, type AgentId} from '@evidence-locker/agents';
import {ROLE_SCOPES, ROLE_TO_AGENT, type RoleName} from '../apps/web/app/lib/authz';

describe('role -> permission expectations', () => {
  it('the intended scope sets for Analyst, Reviewer, Custodian', () => {
    expect(ROLE_SCOPES.Analyst).toEqual(['records:read', 'records:create']);
    expect(ROLE_SCOPES.Reviewer).toEqual(['records:read', 'records:redact']);
    expect(ROLE_SCOPES.Custodian).toEqual(['records:read', 'records:dispose']);
  });

  it('each human role scope set matches the agent that acts for it', () => {
    const roles = Object.keys(ROLE_SCOPES) as RoleName[];
    for (const role of roles) {
      const agentId = ROLE_TO_AGENT[role];
      expect([...AGENTS[agentId].expectedScopes]).toEqual([...ROLE_SCOPES[role]]);
    }
  });

  it('three distinct roles map to three distinct agents', () => {
    expect(new Set(Object.values(ROLE_TO_AGENT)).size).toBe(3);
  });
});

describe('mintAgentToken — three agents = three distinct identities', () => {
  const ENV: Record<string, string> = {
    KINDE_M2M_TOKEN_URL: 'https://example.kinde.com/oauth2/token',
    KINDE_M2M_AUDIENCE: 'https://locker.api',
    INTAKE_CLIENT_ID: 'intake-client',
    INTAKE_CLIENT_SECRET: 'intake-secret',
    REVIEW_CLIENT_ID: 'review-client',
    REVIEW_CLIENT_SECRET: 'review-secret',
    DISPOSITION_CLIENT_ID: 'disposition-client',
    DISPOSITION_CLIENT_SECRET: 'disposition-secret'
  };

  beforeEach(() => {
    for (const [key, value] of Object.entries(ENV)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(ENV)) {
      delete process.env[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubFetchOk() {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({access_token: 'tok', token_type: 'Bearer', expires_in: 3600})
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('each agent sends its OWN distinct client_id and the API audience', async () => {
    const fetchMock = stubFetchOk();
    const agentIds: AgentId[] = ['intake', 'review', 'disposition'];

    for (const id of agentIds) {
      await mintAgentToken(id);
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const sent = agentIds.map((_id, index) => {
      const [url, init] = fetchMock.mock.calls[index];
      const body = init.body as URLSearchParams;
      return {
        url,
        grant: body.get('grant_type'),
        clientId: body.get('client_id'),
        audience: body.get('audience')
      };
    });

    expect(sent.map((s) => s.clientId)).toEqual(['intake-client', 'review-client', 'disposition-client']);
    // Three distinct identities.
    expect(new Set(sent.map((s) => s.clientId)).size).toBe(3);

    for (const s of sent) {
      expect(s.url).toBe(ENV.KINDE_M2M_TOKEN_URL);
      expect(s.grant).toBe('client_credentials');
      expect(s.audience).toBe(ENV.KINDE_M2M_AUDIENCE);
    }
  });

  it('returns the minted token fields', async () => {
    stubFetchOk();
    const token = await mintAgentToken('intake');
    expect(token).toEqual({accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600});
  });

  it('throws (before any fetch) when a required credential is missing', async () => {
    const fetchMock = stubFetchOk();
    delete process.env.REVIEW_CLIENT_SECRET;

    await expect(mintAgentToken('review')).rejects.toThrow(/REVIEW_CLIENT_SECRET/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
