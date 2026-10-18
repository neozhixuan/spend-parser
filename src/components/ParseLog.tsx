import { useState } from 'react';
import { useStore, collectIssues, downloadLog, downloadDebug } from '../store.ts';

const RANK = { error: 3, warn: 2, info: 1, ok: 0 };

export function ParseLog() {
  const state = useStore();
  const [level, setLevel] = useState('all');
  const [file, setFile] = useState('');
  // A removed file drops out of the filter, as if "All files" were picked.
  const fileFilter = state.files.some(f => f.name === file) ? file : '';
  const items = collectIssues()
    .filter(i => (!fileFilter || i.file === fileFilter) && (level === 'all' || (level === 'error' ? i.level === 'error' : RANK[i.level] >= 2)))
    .sort((a, b) => RANK[b.level] - RANK[a.level]);
  return (
    <section className="card">
      <div className="row-between">
        <h2>Parse log</h2>
        <div className="controls">
          <select value={level} onChange={e => setLevel(e.target.value)}>
            <option value="all">All levels</option>
            <option value="error">Errors</option>
            <option value="warn">Warnings &amp; errors</option>
          </select>
          <select value={fileFilter} onChange={e => setFile(e.target.value)}>
            <option value="">All files</option>
            {state.files.map(f => <option key={f.key}>{f.name}</option>)}
          </select>
          <button className="ghost" onClick={downloadLog}>Download log</button>
          <button className="ghost" onClick={downloadDebug} title="Every extracted line with all digits replaced by 0 — safe to share for debugging a layout change">Masked debug dump</button>
        </div>
      </div>
      <div className="log">
        {items.length ? items.map((i, n) => (
          <div key={n} className={`issue ${i.level}`}>
            <div className="where">{i.level.toUpperCase()} · {i.file}{i.page ? ` · page ${i.page}` : ''}</div>
            <div>{i.msg}</div>
            {i.text && <code>{i.text}</code>}
          </div>
        )) : <p className="muted">Nothing at this level.</p>}
      </div>
    </section>
  );
}
