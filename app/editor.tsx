'use client';

import dynamic from 'next/dynamic';

// The editor uses browser APIs at import and render time, so it is loaded
// client-only. OG/canonical metadata is still server-rendered from layout.tsx.
const App = dynamic(() => import('@/src/app'), { ssr: false });

export default function Editor() {
  return <App />;
}
