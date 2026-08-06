'use client';

import type {ReactNode} from 'react';
import {ConvexProvider, ConvexReactClient} from 'convex/react';

// Client providers. This is a 'use client' module so it can hold the Convex React
// client — it MUST NOT be rendered as part of the server layout tree directly;
// the layout imports and renders <Providers> (a client boundary) instead.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? '';
const convex = convexUrl.length > 0 ? new ConvexReactClient(convexUrl) : null;

export default function Providers({children}: {children: ReactNode}) {
  if (convex === null) {
    return (
      <div className="notice notice-warn">
        <code>NEXT_PUBLIC_CONVEX_URL</code> is not set. Run <code>npx convex dev</code> in{' '}
        <code>apps/web</code> and reload.
      </div>
    );
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
