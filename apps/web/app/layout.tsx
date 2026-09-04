import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'REFLEXCHAIN · Proof of Reflex',
  description:
    'A distributed, cryptographically verified, quorum-approved answer to the question of who pressed a button first.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="scanlines min-h-screen bg-ink-900 text-slate-300 antialiased">
        {children}
      </body>
    </html>
  );
}
