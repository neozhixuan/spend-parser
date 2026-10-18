import { useState } from 'react';
import { fmt } from '../lib/parsers.ts';
import type { Kind, Txn } from '../lib/types.ts';
import { useStore, allCategories, setCategory, setKind, setRemember } from '../store.ts';

const KINDS: Kind[] = ['expense', 'income', 'transfer'];
const NEW_CATEGORY = '__new';

function Row({ t, cats }: { t: Txn; cats: string[] }) {
  const cls = [t.manual && 'manual', t.kind === 'transfer' && 'transfer', t.category === 'Uncategorised' && 'uncat'].filter(Boolean).join(' ');
  const onCategory = (v: string) => {
    if (v === NEW_CATEGORY) {
      v = (prompt('New category name:') || '').trim();
      if (!v) return;
    }
    setCategory(t.id, v);
  };
  return (
    <tr className={cls}>
      <td className="num">{t.date}</td>
      <td>{t.account}</td>
      <td>
        <div>
          {t.merchant || '—'}
          {!t.saved ? <span className="pill new">new</span> : t.dirty ? <span className="pill new">edited</span> : null}
        </div>
        {t.description && t.description !== t.merchant && (
          <div className="desc" title={t.source ? `page ${t.source.page}: ${t.source.text}` : undefined}>{t.description}</div>
        )}
      </td>
      <td className={`num ${t.amount < 0 ? 'neg' : 'pos'}`}>{t.amount < 0 ? '−' : '+'}{fmt(Math.abs(t.amount))}</td>
      <td>
        <select className="cat" value={t.category} onChange={e => onCategory(e.target.value)}>
          {cats.map(c => <option key={c}>{c}</option>)}
          <option value={NEW_CATEGORY}>+ New category…</option>
        </select>
        {t.matchedWith && <div className="desc">matched pair</div>}
      </td>
      <td>
        <select className="kind" value={t.kind} onChange={e => setKind(t.id, e.target.value as Kind)}>
          {KINDS.map(k => <option key={k}>{k}</option>)}
        </select>
      </td>
    </tr>
  );
}

export function ReviewTable() {
  const state = useStore();
  const [q, setQ] = useState('');
  const [month, setMonthFilter] = useState('');
  const [account, setAccount] = useState('');
  const [kind, setKindFilter] = useState('');
  const [uncatOnly, setUncatOnly] = useState(false);
  const [unsavedOnly, setUnsavedOnly] = useState(false);

  const months = [...new Set(state.txns.map(t => t.date.slice(0, 7)))].sort();
  const accounts = [...new Set(state.txns.map(t => t.account))].sort();
  // A filter value that no longer exists falls back to "All".
  const m = months.includes(month) ? month : '';
  const a = accounts.includes(account) ? account : '';
  const needle = q.trim().toLowerCase();
  const rows = state.txns.filter(t =>
    (!m || t.date.startsWith(m)) && (!a || t.account === a) && (!kind || t.kind === kind) &&
    (!uncatOnly || t.category === 'Uncategorised') && (!unsavedOnly || !t.saved || t.dirty) &&
    (!needle || `${t.merchant} ${t.description}`.toLowerCase().includes(needle)));
  const cats = allCategories();
  const uncat = state.txns.filter(t => t.category === 'Uncategorised').length;
  const unsaved = state.txns.filter(t => !t.saved || t.dirty).length;

  return (
    <section className="card">
      <div className="row-between">
        <h2><span className="step">2</span> Review &amp; categorise</h2>
        <label className="check">
          <input type="checkbox" checked={state.remember} onChange={e => setRemember(e.target.checked)} /> Changing a category creates a rule for that merchant
        </label>
      </div>
      <div className="controls filters">
        <input type="search" placeholder="Search merchant or description" value={q} onChange={e => setQ(e.target.value)} />
        <select value={m} onChange={e => setMonthFilter(e.target.value)}>
          <option value="">All months</option>
          {months.map(v => <option key={v}>{v}</option>)}
        </select>
        <select value={a} onChange={e => setAccount(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map(v => <option key={v}>{v}</option>)}
        </select>
        <select value={kind} onChange={e => setKindFilter(e.target.value)}>
          <option value="">All kinds</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
        <label className="check"><input type="checkbox" checked={uncatOnly} onChange={e => setUncatOnly(e.target.checked)} /> Uncategorised only</label>
        <label className="check"><input type="checkbox" checked={unsavedOnly} onChange={e => setUnsavedOnly(e.target.checked)} /> Unsaved only</label>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Merchant / description</th><th className="num">Amount</th><th>Category</th><th>Kind</th></tr></thead>
          <tbody>{rows.map(t => <Row key={t.id} t={t} cats={cats} />)}</tbody>
        </table>
      </div>
      <p className="muted">Showing {rows.length} of {state.txns.length} transactions · {uncat} uncategorised · {unsaved} not yet saved · highlighted rows were set by you</p>
    </section>
  );
}
