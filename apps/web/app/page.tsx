import {getKindeServerSession} from '@kinde-oss/kinde-auth-nextjs/server';
import {getHumanContext, type HumanContext} from './lib/session';
import Dashboard from './components/dashboard';

// The demo operates on one seeded org and needs NO account. A signed-in Kinde
// user's name is shown as a quiet extra; the panels read this demo org either way.
const DEMO_ORG = process.env.NEXT_PUBLIC_DEMO_ORG_CODE ?? 'orgA';

// Login is entirely OPTIONAL — never a gate. Resolve the session defensively so an
// anonymous visitor (or an unconfigured Kinde) always lands on the full working
// dashboard rather than an error or a sign-in screen.
async function resolveSession(): Promise<{signedIn: boolean; session: HumanContext | null}> {
  try {
    const {isAuthenticated} = getKindeServerSession();
    const signedIn = (await isAuthenticated()) ?? false;
    return {signedIn, session: signedIn ? await getHumanContext() : null};
  } catch {
    return {signedIn: false, session: null};
  }
}

export default async function HomePage() {
  const {signedIn, session} = await resolveSession();
  return <Dashboard orgCode={DEMO_ORG} signedIn={signedIn} session={session} />;
}
