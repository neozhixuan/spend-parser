import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import posbUrl from '../../test/mocks/POSB_Consolidated_2026-09.pdf?url';
import scUrl from '../../test/mocks/SC_JumpStart_2026-09.pdf?url';
import paylahUrl from '../../test/mocks/PayLah_2026-09.pdf?url';
import { useStore, handleFiles } from '../store.ts';

// Fictional September 2026 statements from the test suite: one per supported bank.
const MOCKS = [
  { file: 'POSB_Consolidated_2026-09.pdf', bank: 'POSB / DBS', url: posbUrl },
  { file: 'SC_JumpStart_2026-09.pdf', bank: 'Standard Chartered', url: scUrl },
  { file: 'PayLah_2026-09.pdf', bank: 'DBS PayLah!', url: paylahUrl },
];

// First page of a PDF, drawn at the canvas's on-screen width.
function Thumb({ url }: { url: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const task = pdfjs.getDocument({ url, verbosity: 0 });
    let stopped = false;
    task.promise.then(async pdf => {
      const page = await pdf.getPage(1);
      const canvas = ref.current;
      if (stopped || !canvas) return;
      const viewport = page.getViewport({ scale: (canvas.clientWidth * devicePixelRatio) / page.getViewport({ scale: 1 }).width });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
    }).catch(() => { /* the card still links to the PDF */ });
    return () => { stopped = true; task.destroy(); };
  }, [url]);
  return <canvas ref={ref} className="mock-thumb" aria-hidden="true" />;
}

export function MockStatements() {
  const state = useStore();
  const [loading, setLoading] = useState(false);
  const loaded = MOCKS.every(m => state.files.some(f => f.name === m.file));

  const load = async () => {
    setLoading(true);
    try {
      const files = await Promise.all(MOCKS.map(async m => new File([await (await fetch(m.url)).blob()], m.file, { type: 'application/pdf' })));
      await handleFiles(files);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mocks">
      <div className="mocks-head">
        <div>
          <h3>No statements handy? Try it out with mock statements!</h3>
          <p className="muted small">Fictional September 2026 statements, one per bank. Every page is watermarked "MOCK STATEMENT". Click a card to preview the PDF.</p>
        </div>
        <button onClick={load} disabled={loading || loaded}>{loaded ? 'Mock statements loaded' : loading ? 'Loading…' : 'Load all 3 mock statements'}</button>
      </div>
      <div className="mock-cards">
        {MOCKS.map(m => (
          <a key={m.file} className="mock-card" href={m.url} target="_blank" rel="noopener" title={`Preview ${m.file}`}>
            <Thumb url={m.url} />
            <span className="mock-name"><b>{m.bank}</b><span className="muted small">{m.file}</span></span>
          </a>
        ))}
      </div>
    </div>
  );
}
