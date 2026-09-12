import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import styles from './debug.module.css';

const SAMPLE = 'The quick brown fox jumps over the lazy dog.';

const MIN_SIZE = 14;
const MAX_SIZE = 22.5 * 2;
const STEP = 0.1;

// 14.0 … 24.0 in STEP-sized increments. Each size is derived from its index
// rather than accumulated, so the labels and the font-size values stay exact
// instead of drifting; the rounding trims the float noise of index * STEP.
const SIZES = Array.from(
  { length: Math.floor((MAX_SIZE - MIN_SIZE) / STEP) + 1 },
  (_, index) => Math.round((MIN_SIZE + index * STEP) * 1000) / 1000
);

// Enough decimals to tell one step from the next, and no more.
const DECIMALS = (String(STEP).split('.')[1] ?? '').length;

const brutalita = localFont({
  src: [{ path: '../../public/font/Brutalita-Regular.woff2', weight: '400' }],
  display: 'block',
  variable: '--font-brutalita',
});

export const metadata: Metadata = {
  title: 'Brutalita — Size debug',
  robots: { index: false, follow: false },
};

export default function DebugPage() {
  // Local-only tool: the deployed build has no route here.
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  return (
    <main className={`${styles.page} ${brutalita.variable}`}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Brutalita Regular / 400</h1>
        <p className={styles.meta}>
          {SAMPLE} — {MIN_SIZE}px to {MAX_SIZE}px in {STEP}px steps.
        </p>
        <Link className={styles.back} href="/">
          Back to editor
        </Link>
      </header>

      <ol className={styles.rows}>
        {SIZES.map((size) => (
          <li className={styles.row} key={size}>
            <span className={styles.size}>{size.toFixed(DECIMALS)}px</span>
            <span className={styles.sample} style={{ fontSize: `${size}px` }}>
              {SAMPLE}
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
