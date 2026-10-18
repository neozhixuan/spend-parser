import { useEffect, useRef, useState } from 'react';
import type { FileEntry } from '../store.ts';

// Every line the parser extracted from one file, with the role it was given.
export function InspectDialog({ file, onClose }: { file: FileEntry | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tag, setTag] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (file && !d.open) { setTag(''); d.showModal(); }
    if (!file && d.open) d.close();
  }, [file]);

  const lines = file?.result?.pages.flatMap(p => p.lines) || [];
  const tags = [...new Set(lines.map(l => l.tag || '—'))].sort();
  return (
    <dialog ref={ref} onClose={onClose}>
      <div className="row-between">
        <h2>Extracted lines — {file?.name}</h2>
        <div className="controls">
          <select value={tag} onChange={e => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags.map(t => <option key={t}>{t}</option>)}
          </select>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
      <p className="muted small">Each line as the parser saw it, with the role it was given. <b>row</b> starts a transaction, <b>cont</b> continues one, <b>unparsed</b> lines inside a table were skipped.</p>
      <div className="table-wrap tall">
        <table className="inspect-table">
          <thead><tr><th>Page</th><th>y</th><th>Tag</th><th>Text</th></tr></thead>
          <tbody>
            {lines.filter(l => !tag || (l.tag || '—') === tag).map((l, i) => (
              <tr key={i}><td>{l.page}</td><td className="num">{l.y}</td><td><span className={`tag ${l.tag}`}>{l.tag || '—'}</span></td><td>{l.text}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </dialog>
  );
}
