import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';

import { styleName } from '@/src/weights';
import styles from './demo.module.css';

const DEMO_WEIGHTS = [300, 400, 500, 700];
const SIZES = [12, 14, 16, 18, 24, 32, 48, 72, 96];

// The checked radio drives --font-specimen through :has(), so the page swaps
// family with no client JavaScript at all.
const FAMILIES = [
  { value: 'proportional', label: 'Proportional' },
  { value: 'mono', label: 'Monospace' },
];

const brutalita = localFont({
  src: [
    { path: '../../public/font/Brutalita-Light.woff2', weight: '300' },
    { path: '../../public/font/Brutalita-Regular.woff2', weight: '400' },
    { path: '../../public/font/Brutalita-Medium.woff2', weight: '500' },
    { path: '../../public/font/Brutalita-Bold.woff2', weight: '700' },
  ],
  display: 'swap',
  variable: '--font-brutalita',
});

const brutalitaMono = localFont({
  src: [
    { path: '../../public/font/Brutalita Mono-Light.woff2', weight: '300' },
    { path: '../../public/font/Brutalita Mono-Regular.woff2', weight: '400' },
    { path: '../../public/font/Brutalita Mono-Medium.woff2', weight: '500' },
    { path: '../../public/font/Brutalita Mono-Bold.woff2', weight: '700' },
  ],
  display: 'swap',
  variable: '--font-brutalita-mono',
});

const title = 'Brutalita — Web font demo';
const description = 'An experimental geometric typeface. Explore proportional and monospace Brutalita in four weights, from small text to big statements.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/demo' },
  openGraph: { title, description, url: 'https://brutalita.com/demo' },
  twitter: { title, description },
};

export default function DemoPage() {
  return (
    <main className={`${styles.page} ${brutalita.variable} ${brutalitaMono.variable}`}>
      <div className={styles.inner}>
        <nav className={styles.nav} aria-label="Main navigation">
          <Link className={styles.brand} href="/">Brutalita</Link>

          <fieldset className={styles.familyToggle}>
            <legend className={styles.srOnly}>Spacing</legend>
            {FAMILIES.map(({ value, label }, index) => (
              <label className={styles.familyOption} data-family={value} key={value}>
                <input type="radio" name="family" value={value} defaultChecked={index === 0} />
                {/* Each option is set in the family it selects. */}
                <span>{label}</span>
              </label>
            ))}
          </fieldset>

          <Link href="/">Open font editor ↗</Link>
        </nav>

        <header className={styles.hero}>
          <p className={styles.label}>An experimental geometric typeface</p>
          <h1 className={styles.title}>Brutalita.</h1>
          <p className={styles.intro}>Simple shapes. A little attitude.<br />Four weights, straight from your browser.</p>
        </header>

        <section className={styles.section} aria-labelledby="weights">
          <h2 id="weights" className={styles.label}>01 / Weights</h2>
          {DEMO_WEIGHTS.map((weight) => (
            <div className={styles.weightRow} key={weight}>
              <p className={styles.label}>{styleName({ weight })} / {weight}</p>
              <p className={styles.weightSample} style={{ fontWeight: weight }}>Form follows fun.</p>
            </div>
          ))}
        </section>

        <section className={styles.section} aria-labelledby="sizes">
          <h2 id="sizes" className={styles.label}>02 / Sizes <span>Regular / 400</span></h2>
          {SIZES.map((size) => (
            <div className={styles.sizeRow} key={size}>
              <p className={styles.label}>{size} px</p>
              <p className={styles.sizeSample} style={{ fontSize: size, lineHeight: `${Math.ceil(size * 1.5)}px` }}>
                {size >= 72 ? 'Type with bite.' : 'The quick brown fox jumps over the lazy dog.'}
              </p>
            </div>
          ))}
        </section>

        <section className={styles.section} aria-labelledby="text">
          <h2 id="text" className={styles.label}>03 / In words</h2>
          <div className={styles.columns}>
            {DEMO_WEIGHTS.map((weight) => (
              <div key={weight}>
                <p className={styles.label}>{styleName({ weight })} / 16 px</p>
                <p className={styles.bodySample} style={{ fontWeight: weight }}>
                  A typeface starts with a few simple shapes. Lines meet, corners turn,
                  and a rhythm begins to appear. Set it small and let it speak.
                  Set it big and give every letter room to play.
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <p>Made to be played with.</p>
          <Link href="/">Make it your own ↗</Link>
        </footer>
      </div>
    </main>
  );
}
