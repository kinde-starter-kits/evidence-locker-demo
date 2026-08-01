import {handleAuth} from '@kinde-oss/kinde-auth-nextjs/server';

// Kinde's catch-all auth handler: /api/auth/login, /logout, /register, /kinde_callback.
export const GET = handleAuth();
