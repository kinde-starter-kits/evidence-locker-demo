export type AuthzMode = 'broken' | 'enforced';

/**
 * The app's authorization mode, read SERVER-SIDE from the Convex deployment env
 * ONLY. It never reads a header, body, or query param — a request cannot choose
 * its mode. Defaults to "broken" for this phase (P5); P6 sets AUTHZ_MODE=enforced
 * and wires the Kinde agent-auth component.
 */
export function getAuthzMode(): AuthzMode {
  return process.env.AUTHZ_MODE === 'enforced' ? 'enforced' : 'broken';
}
