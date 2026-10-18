import { fmt } from '../lib/parsers.ts';
import { useStore } from '../store.ts';

const sumOf = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

function Cell({ v }: { v: number }) {
  return <td className="num">{Math.abs(v) < 0.005 ? <span className="muted">–</span> : fmt(v)}</td>;
}

export function Summary() {
  const state = useStore();
  const months = [...new Set(state.txns.map(t => t.date.slice(0, 7)))].sort();
  const zeros = () => Object.fromEntries(months.map(m => [m, 0]));
  const spend: Record<string, Record<string, number>> = {};
  const income = zeros();
  for (const t of state.txns) {
    const m = t.date.slice(0, 7);
    if (t.kind === 'expense') { spend[t.category] ??= zeros(); spend[t.category][m] -= t.amount; }
    else if (t.kind === 'income') income[m] += t.amount;
  }
  const cats = Object.keys(spend).sort((a, b) => sumOf(spend[b]) - sumOf(spend[a]));
  const totals = Object.fromEntries(months.map(m => [m, cats.reduce((s, c) => s + spend[c][m], 0)]));
  return (
    <section className="card">
      <h2>Monthly summary <span className="muted small">(spending only — transfers excluded)</span></h2>
      <div className="table-wrap">
        <table className="summary">
          <thead><tr><th>Category</th>{months.map(m => <th key={m} className="num">{m}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {cats.map(c => (
              <tr key={c}><td>{c}</td>{months.map(m => <Cell key={m} v={spend[c][m]} />)}<Cell v={sumOf(spend[c])} /></tr>
            ))}
            <tr className="total"><td>Total spending</td>{months.map(m => <Cell key={m} v={totals[m]} />)}<Cell v={sumOf(totals)} /></tr>
            <tr><td className="muted">Income</td>{months.map(m => <Cell key={m} v={income[m]} />)}<Cell v={sumOf(income)} /></tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
