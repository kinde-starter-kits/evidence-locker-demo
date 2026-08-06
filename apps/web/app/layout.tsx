import type {Metadata} from 'next';
import type {ReactNode} from 'react';
import {Inter, Fira_Code} from 'next/font/google';
import Providers from './providers';
import './globals.css';

const inter = Inter({subsets: ['latin'], variable: '--font-sans', display: 'swap'});
const firaCode = Fira_Code({subsets: ['latin'], variable: '--font-mono', display: 'swap'});

export const metadata: Metadata = {
  title: 'Evidence Locker',
  description: 'Agent actions, authorized and recorded — Kinde agent auth on Convex.'
};

// Server layout. Client providers live in <Providers> (a 'use client' boundary),
// never rendered directly here.
export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className={`${inter.variable} ${firaCode.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
