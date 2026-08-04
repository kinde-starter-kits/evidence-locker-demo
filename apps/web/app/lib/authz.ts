// Canonical human role -> permission (scope) sets the app expects from Kinde.
//
// Permissions ARE the scopes. Roles bundle them in Kinde, so at runtime the app
// reads permissions (see getHumanContext), not role names. These declared sets
// mirror the M2M agents' expectedScopes in packages/agents, so a human role and
// the agent that acts for it carry the same authority. The tests assert the two
// stay aligned.
//
// This module is intentionally pure (no Kinde/React import) so it can be imported
// from tests and shared without pulling the web runtime.

export type RoleName = 'Analyst' | 'Reviewer' | 'Custodian';

export type AgentId = 'intake' | 'review' | 'disposition';

export const ROLE_SCOPES: Record<RoleName, readonly string[]> = {
  Analyst: ['records:read', 'records:create'],
  Reviewer: ['records:read', 'records:annotate'],
  Custodian: ['records:read', 'records:redact', 'records:export', 'records:delete']
};

// Which M2M agent acts for each human role.
export const ROLE_TO_AGENT: Record<RoleName, AgentId> = {
  Analyst: 'intake',
  Reviewer: 'review',
  Custodian: 'disposition'
};
