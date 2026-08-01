import {getKindeServerSession} from '@kinde-oss/kinde-auth-nextjs/server';
import {LoginLink, LogoutLink} from '@kinde-oss/kinde-auth-nextjs/components';
import {getHumanContext} from './lib/session';

export default async function HomePage() {
  const {isAuthenticated} = getKindeServerSession();
  const signedIn = await isAuthenticated();

  if (!signedIn) {
    return (
      <main>
        <h1>Evidence Locker</h1>
        <LoginLink>Sign in</LoginLink>
      </main>
    );
  }

  const {sub, orgCode, permissions} = await getHumanContext();

  return (
    <main>
      <h1>Evidence Locker</h1>
      <p>Signed in as {sub ?? 'unknown'}</p>
      <p>Organization: {orgCode ?? 'none'}</p>
      <h2>Permissions (scopes)</h2>
      {permissions.length === 0 ? (
        <p>No permissions resolved for this user.</p>
      ) : (
        <ul>
          {permissions.map((permission) => (
            <li key={permission}>{permission}</li>
          ))}
        </ul>
      )}
      <LogoutLink>Sign out</LogoutLink>
    </main>
  );
}
