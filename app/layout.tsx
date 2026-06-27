import '@/src/style.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GoogleAnalytics } from '@next/third-parties/google';

const TITLE = 'Brutalita Sans';
const DESCRIPTION =
  'Brutalita is an experimental font and font editor, edit in your browser and download OTF.';

export const metadata: Metadata = {
  metadataBase: new URL('https://brutalita.com'),
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://brutalita.com/',
    type: 'website',
    images: [{ url: '/brutalita.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/brutalita.jpg'],
  },
  icons: {
    shortcut: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <noscript>
          <h1>Brutalita Sans</h1>
          <p>
            Brutalita is an experimental geometric font and browser-based font
            editor. Edit glyphs in your browser and download your custom font as
            an OTF file.
          </p>
          <p>
            <a href="/Brutalita-400.otf">Download Brutalita Regular (OTF)</a>
          </p>
        </noscript>
      </body>
      <GoogleAnalytics gaId="G-M2FT27FXS2" />
    </html>
  );
}
