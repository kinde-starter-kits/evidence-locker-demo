import {getKindeServerSession} from '@kinde-oss/kinde-auth-nextjs/server';

export interface HumanContext {
  sub: string | null;
  orgCode: string | null;
  permissions: string[];
}

/**
 * Server helper: the signed-in human's subject, organization, and resolved
 * permissions. The schema is orgCode-scoped, so every human context carries the
 * org. Permissions ARE the scopes — roles bundle them in Kinde, so we read
 * permissions, not role names.
 */
export async function getHumanContext(): Promise<HumanContext> {
  const {getUser, getOrganization, getPermissions} = getKindeServerSession();
  const user = await getUser();
  const organization = await getOrganization();
  const perms = await getPermissions();
  return {
    sub: user?.id ?? null,
    orgCode: organization?.orgCode ?? null,
    permissions: perms?.permissions ?? []
  };
}
