import {getKindeServerSession} from '@kinde-oss/kinde-auth-nextjs/server';

export interface HumanContext {
  sub: string | null;
  /** A human-friendly label — name or email — falling back to the id only if none. */
  displayName: string | null;
  orgCode: string | null;
  permissions: string[];
}

// Prefer a name, then email, then the raw Kinde id — never show `kp_…` if we can help it.
function resolveDisplayName(user: {
  id: string;
  email: string | null;
  given_name: string | null;
  family_name: string | null;
}): string {
  const name = [user.given_name, user.family_name].filter((part) => part !== null && part.length > 0).join(' ').trim();
  if (name.length > 0) return name;
  if (user.email !== null && user.email.length > 0) return user.email;
  return user.id;
}

/**
 * Server helper: the signed-in human's subject, display name, organization, and
 * resolved permissions. The schema is orgCode-scoped, so every human context
 * carries the org. Permissions ARE the scopes — roles bundle them in Kinde, so we
 * read permissions, not role names.
 */
export async function getHumanContext(): Promise<HumanContext> {
  const {getUser, getOrganization, getPermissions} = getKindeServerSession();
  const user = await getUser();
  const organization = await getOrganization();
  const perms = await getPermissions();
  return {
    sub: user?.id ?? null,
    displayName: user === null ? null : resolveDisplayName(user),
    orgCode: organization?.orgCode ?? null,
    permissions: perms?.permissions ?? []
  };
}
