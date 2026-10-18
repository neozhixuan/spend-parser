import type { CSSProperties, ReactNode } from 'react';
import posb1 from '../assets/guide/posb-1.jpg';
import posb2 from '../assets/guide/posb-2.jpg';
import posb3 from '../assets/guide/posb-3.jpg';
import sc1 from '../assets/guide/sc-1.jpg';
import sc2 from '../assets/guide/sc-2.jpg';
import sc3 from '../assets/guide/sc-3.jpg';
import paylah1 from '../assets/guide/paylah-1.jpg';
import paylah2 from '../assets/guide/paylah-2.jpg';
import paylah3 from '../assets/guide/paylah-3.jpg';

interface Step { text: ReactNode; img: string; alt: string }

// Screenshots are cropped to leave out names and account numbers: this page is public.
const BANKS: { name: string; app: string; color: string; steps: Step[] }[] = [
  {
    name: 'POSB / DBS', app: 'digibank app', color: '#c8102e',
    steps: [
      { text: <>Tap <b>More</b> in the bottom bar.</>, img: posb1, alt: 'digibank bottom bar with More highlighted' },
      { text: <>Under Quick Access, tap <b>eDocuments</b>.</>, img: posb2, alt: 'Quick Access tiles with eDocuments highlighted' },
      { text: <>On <b>eStatements</b>, tap ⤓ beside each month's Consolidated Statement.</>, img: posb3, alt: 'eStatements list showing the September 2026 consolidated statement' },
    ],
  },
  {
    name: 'Standard Chartered', app: 'SC Mobile app', color: '#0473ea',
    steps: [
      { text: <>Tap <b>Services</b> in the bottom bar.</>, img: sc1, alt: 'SC Mobile bottom bar with Services highlighted' },
      { text: <>Tap <b>View eStatements/eAdvices</b>.</>, img: sc2, alt: 'Popular Links with View eStatements/eAdvices highlighted' },
      { text: <>The latest is on top. Open <b>Past Statement</b> for older months.</>, img: sc3, alt: 'eStatements screen with the Past Statement tab highlighted' },
    ],
  },
  {
    name: 'DBS PayLah!', app: 'PayLah! app', color: '#f26522',
    steps: [
      { text: <>Tap <b>More</b> in the bottom bar.</>, img: paylah1, alt: 'PayLah! bottom bar with More highlighted' },
      { text: <>Tap <b>eStatements</b>.</>, img: paylah2, alt: 'More menu with eStatements highlighted' },
      { text: <>Tap each month to open its PDF, then save it to Files.</>, img: paylah3, alt: 'eStatements list of months with September 2026 highlighted' },
    ],
  },
];

export function GuideHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <p className="hero-eyebrow">Before you start</p>
      <h2 id="hero-title">Grab every statement, then drop them in at once</h2>
      <p className="hero-sub">Download the monthly PDFs from each banking app, then add them all together in step 1. Overlapping months are counted once, and nothing leaves this tab.</p>
      <div className="banks">
        {BANKS.map(b => (
          <article key={b.name} className="bank" style={{ '--bank': b.color } as CSSProperties}>
            <header className="bank-head">
              <h3>{b.name}</h3>
              <span className="bank-app">{b.app}</span>
            </header>
            <ol className="guide-steps">
              {b.steps.map((s, i) => (
                <li key={i} className="guide-step">
                  <span className="guide-num" aria-hidden="true">{i + 1}</span>
                  <p>{s.text}</p>
                  <img src={s.img} alt={s.alt} width={600} height={300} loading="lazy" />
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}
