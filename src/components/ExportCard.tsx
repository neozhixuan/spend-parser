import { useStore, unsavedCounts, exportCsv, save, setClientIdTyped, setSheetIdOverride, setShowAdvanced } from '../store.ts';

export function ExportCard() {
  const state = useStore();
  const u = unsavedCounts();
  const parts = [u.fresh && `${u.fresh} new`, u.edited && `${u.edited} edited`, u.rules && 'rules'].filter(Boolean);
  return (
    <section className="card">
      <h2><span className="step">3</span> Export</h2>
      <div className="export-grid">
        <div>
          <h3>CSV</h3>
          <p className="muted small">No setup. Import into any sheet with File → Import.</p>
          <button onClick={exportCsv}>Download CSV</button>
        </div>
        <div>
          <h3>Your tracker (Google Sheets)</h3>
          <p className="muted small">New transactions, category changes, your rules and account balances are saved to a "Spending tracker" spreadsheet in your own Google Drive. This page can only open spreadsheets it created — nothing else in your Drive.</p>
          <button disabled={state.busy} onClick={save}>{parts.length ? `Save to tracker (${parts.join(', ')})` : 'Save to tracker'}</button>
          <div className="sheet-log">
            {state.sheetLog.map((l, i) => (
              <div key={i}>
                <div className={l.cls}>{l.time}  {l.msg}</div>
                {l.link && <div><a href={l.link} target="_blank" rel="noopener">Open the spreadsheet ↗</a></div>}
              </div>
            ))}
          </div>
          <details className="advanced" open={state.showAdvanced} onToggle={e => setShowAdvanced(e.currentTarget.open)}>
            <summary>Advanced</summary>
            <label className="field">
              <span>OAuth Client ID <span className="muted small">(only needed if src/config.ts is empty)</span></span>
              <input placeholder="1234-abc.apps.googleusercontent.com" autoComplete="off" value={state.clientIdTyped} onChange={e => setClientIdTyped(e.target.value)} />
            </label>
            <label className="field">
              <span>Spreadsheet ID override <span className="muted small">(must be one this page created)</span></span>
              <input autoComplete="off" value={state.sheetIdOverride} onChange={e => setSheetIdOverride(e.target.value)} />
            </label>
          </details>
        </div>
      </div>
    </section>
  );
}
