import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { SHIPPED_WEIGHTS, styleName } from '@/src/weights';
import styles from './debug.module.css';

const SAMPLE = 'The quick brown fox jumps over the lazy dog.';

const MIN_SIZE = 14;
const MAX_SIZE = 22.5 * 2;
const STEP = 0.1;

const DEFAULT_WEIGHT = 400;

// 14.0 … 24.0 in STEP-sized increments. Each size is derived from its index
// rather than accumulated, so the labels and the font-size values stay exact
// instead of drifting; the rounding trims the float noise of index * STEP.
const SIZES = Array.from(
  { length: Math.floor((MAX_SIZE - MIN_SIZE) / STEP) + 1 },
  (_, index) => Math.round((MIN_SIZE + index * STEP) * 1000) / 1000
);

// Enough decimals to tell one step from the next, and no more.
const DECIMALS = (String(STEP).split('.')[1] ?? '').length;

// next/font reads this call at build time, so the shipped weights are spelled
// out here rather than mapped over SHIPPED_WEIGHTS.
const brutalita = localFont({
  src: [
    { path: '../../public/font/Brutalita-Thin.woff2', weight: '100' },
    { path: '../../public/font/Brutalita-ExtraLight.woff2', weight: '200' },
    { path: '../../public/font/Brutalita-Light.woff2', weight: '300' },
    { path: '../../public/font/Brutalita-Regular.woff2', weight: '400' },
    { path: '../../public/font/Brutalita-Medium.woff2', weight: '500' },
    { path: '../../public/font/Brutalita-SemiBold.woff2', weight: '600' },
    { path: '../../public/font/Brutalita-Bold.woff2', weight: '700' },
    { path: '../../public/font/Brutalita-ExtraBold.woff2', weight: '800' },
    { path: '../../public/font/Brutalita-Black.woff2', weight: '900' },
  ],
  display: 'block',
  variable: '--font-brutalita',
});

const brutalitaMono = localFont({
  src: [
    { path: '../../public/font/Brutalita Mono-Thin.woff2', weight: '100' },
    { path: '../../public/font/Brutalita Mono-ExtraLight.woff2', weight: '200' },
    { path: '../../public/font/Brutalita Mono-Light.woff2', weight: '300' },
    { path: '../../public/font/Brutalita Mono-Regular.woff2', weight: '400' },
    { path: '../../public/font/Brutalita Mono-Medium.woff2', weight: '500' },
    { path: '../../public/font/Brutalita Mono-SemiBold.woff2', weight: '600' },
    { path: '../../public/font/Brutalita Mono-Bold.woff2', weight: '700' },
    { path: '../../public/font/Brutalita Mono-ExtraBold.woff2', weight: '800' },
    { path: '../../public/font/Brutalita Mono-Black.woff2', weight: '900' },
  ],
  display: 'block',
  variable: '--font-brutalita-mono',
});

// The two families rasterize differently: the monospace advance is a whole
// number of design steps, so its stems land on the pixel grid at the sizes
// where a step does, and the proportional one's never do.
const FAMILIES = [
  { value: 'sans', name: 'Proportional' },
  { value: 'mono', name: 'Monospace' },
] as const;

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
    <main
      className={`${styles.page} ${brutalita.variable} ${brutalitaMono.variable}`}
    >
      <header className={styles.header}>
        <h1 className={styles.heading}>Brutalita</h1>
        <p className={styles.meta}>
          {SAMPLE} — {MIN_SIZE}px to {MAX_SIZE}px in {STEP}px steps.
        </p>

        {/* The checked radio drives --weight-specimen through :has(), so every
            row restyles with no client JavaScript. */}
        <fieldset className={styles.weights}>
          <legend className={styles.srOnly}>Weight</legend>
          {SHIPPED_WEIGHTS.map((weight) => (
            <label className={styles.weight} data-weight={weight} key={weight}>
              <input
                type="radio"
                name="weight"
                value={weight}
                defaultChecked={weight === DEFAULT_WEIGHT}
              />
              {/* Each option is set in the weight it selects. */}
              <span className={styles.weightValue}>{weight}</span>
              <span className={styles.weightName}>{styleName({ weight })}</span>
            </label>
          ))}
        </fieldset>

        {/* Same control, same mechanism: the checked radio drives
            --family-specimen. */}
        <fieldset className={`${styles.weights} ${styles.families}`}>
          <legend className={styles.srOnly}>Family</legend>
          {FAMILIES.map(({ value, name }) => (
            <label
              className={`${styles.weight} ${styles.family}`}
              data-family={value}
              data-weight={DEFAULT_WEIGHT}
              key={value}
            >
              <input
                type="radio"
                name="family"
                value={value}
                defaultChecked={value === 'sans'}
              />
              {/* Each option is set in the family it selects. */}
              <span className={styles.weightValue}>Hn</span>
              <span className={styles.weightName}>{name}</span>
            </label>
          ))}
        </fieldset>

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
