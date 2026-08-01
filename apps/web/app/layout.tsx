import type {Metadata} from 'next';
import type {ReactNode} from 'react';

export const metadata: Metadata = {
  title: 'Evidence Locker'
};

// Plain server layout. Server components read the session directly via
// getKindeServerSession (cookies) — no provider needed. KindeProvider is a
// client component and MUST NOT be rendered here: doing so breaks the RSC client
// manifest. If a later phase needs client auth hooks (useKindeAuth), wrap
// KindeProvider in a 'use client' app/providers.tsx and import that instead.
export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
