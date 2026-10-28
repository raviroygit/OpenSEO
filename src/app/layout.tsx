import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'OpenSEO', template: '%s · OpenSEO' },
  description: 'Open-source, self-hostable SEO & GEO auditing platform.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by src/proxy.ts from the auth server's Remote-User, when a gate is on.
  const user = (await headers()).get('x-openseo-user');
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-slate-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-semibold tracking-tight">
              Open<span className="text-[var(--color-accent)]">SEO</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm text-slate-400">
              <Link href="/" className="hover:text-slate-100">
                Projects
              </Link>
              {user && <span className="hidden text-slate-500 sm:inline">{user}</span>}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
