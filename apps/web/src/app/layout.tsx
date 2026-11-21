import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'KotaLabs CRM — Multani Motor Body Makers',
  description: 'Lead management and customer enquiry tracking for Multani Motor Body Makers, Kota.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
