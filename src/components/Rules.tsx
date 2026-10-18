import { useStore, deleteRule, exportRules, importRules } from '../store.ts';

export function Rules() {
  const state = useStore();
  return (
    <section className="card">
      <div className="row-between">
        <h2>Your rules</h2>
        <div className="controls">
          <button className="ghost" onClick={exportRules}>Export rules.json</button>
          <label className="ghost button">
            Import rules.json
            <input
              type="file" accept=".json,application/json" hidden
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importRules(f); }}
            />
          </label>
        </div>
      </div>
      <p className="muted small">Tried before the built-in rules. Patterns are case-insensitive regular expressions. Saved in this browser; export a copy to keep next to the site.</p>
      <div>
        {state.rules.length ? state.rules.map((r, i) => (
          <div key={`${i}:${r.match}`} className="rule">
            <code>{r.match}</code>
            <span>{r.category}</span>
            <span className="pill info">{r.kind}</span>
            <button className="ghost" onClick={() => deleteRule(i)}>Delete</button>
          </div>
        )) : <p className="muted small">No rules yet — change a category in the table and one is created for that merchant.</p>}
      </div>
    </section>
  );
}
