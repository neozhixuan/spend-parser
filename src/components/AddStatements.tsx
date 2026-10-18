import { useState, type DragEvent } from 'react';
import { bankLabel } from '../lib/parsers.ts';
import { MockStatements } from './MockStatements.tsx';
import { useStore, handleFiles, removeFile, fileStats, isSignedIn, clientId, doSignIn, type FileEntry } from '../store.ts';

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

function FileRow({ f, onInspect }: { f: FileEntry; onInspect: (f: FileEntry) => void }) {
  if (f.status === 'parsing' || !f.result) {
    return <div className="file"><div><div className="name">{f.name}</div><div className="meta">Parsing…</div></div></div>;
  }
  const r = f.result, s = fileStats(r);
  return (
    <div className="file">
      <div>
        <div className="name">{f.name}</div>
        <div className="meta">
          <span>{bankLabel(r.bank) || 'Unrecognised'}</span>
          <span>{r.transactions.length} transactions</span>
          {s.totalChecks > 0 && <span className={`pill ${s.okChecks === s.totalChecks ? 'ok' : 'err'}`}>{s.okChecks}/{s.totalChecks} balance checks</span>}
          {s.errors > 0 && <span className="pill err">{plural(s.errors, 'error')}</span>}
          {s.warns > 0 && <span className="pill warn">{plural(s.warns, 'warning')}</span>}
          {!s.errors && !s.warns && r.transactions.length > 0 && <span className="pill ok">clean</span>}
        </div>
      </div>
      <div className="controls">
        {r.pages.length > 0 && <button className="ghost" onClick={() => onInspect(f)}>Inspect lines</button>}
        <button className="ghost" onClick={() => removeFile(f.key)}>Remove</button>
      </div>
    </div>
  );
}

export function AddStatements({ onInspect }: { onInspect: (f: FileEntry) => void }) {
  const state = useStore();
  const [over, setOver] = useState(false);
  const dragOn = (e: DragEvent) => { e.preventDefault(); setOver(true); };
  const dragOff = (e: DragEvent) => { e.preventDefault(); setOver(false); };
  return (
    <section className="card">
      <h2><span className="step">1</span> Add statements</h2>
      {!isSignedIn() && clientId() && (
        <div className="hint">
          <span><b>Sign in with Google</b> to load everything you've saved before — then just add each new month's statements.</span>
          <button onClick={() => doSignIn()}>Sign in</button>
        </div>
      )}
      <label
        className={`drop${over ? ' over' : ''}`}
        onDragEnter={dragOn} onDragOver={dragOn} onDragLeave={dragOff}
        onDrop={e => { dragOff(e); handleFiles([...e.dataTransfer.files]); }}
      >
        <input
          type="file" accept="application/pdf,.pdf" multiple hidden
          onChange={e => { handleFiles([...(e.target.files || [])]); e.target.value = ''; }}
        />
        <strong>Drop PDF statements here</strong> or click to choose
        <span className="muted">Parsed inside this tab — PDFs are never uploaded. Anything already in your tracker is skipped automatically.</span>
      </label>
      <MockStatements />
      <div className="files">{state.files.map(f => <FileRow key={f.key} f={f} onInspect={onInspect} />)}</div>
    </section>
  );
}
