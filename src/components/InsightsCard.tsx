import { useState } from 'react';
import { computeInsights, defaultMonth, monthsIn } from '../lib/insights.ts';
import { useStore, latestBalances, setMonth } from '../store.ts';
import { Dashboard } from './Dashboard.tsx';

export function InsightsCard() {
  const state = useStore();
  const [tables, setTables] = useState(false);
  const months = monthsIn(state.txns);
  // Follow the busiest recent month until you pick one yourself.
  const month = state.monthPinned && months.some(m => m.month === state.month) ? state.month! : defaultMonth(state.txns)!;
  const ins = computeInsights(state.txns, month, latestBalances());
  return (
    <section className="card">
      <div className="row-between">
        <h2>Insights</h2>
        <div className="controls">
          <select aria-label="Month" value={month} onChange={e => setMonth(e.target.value)}>
            {months.map(m => <option key={m.month} value={m.month}>{m.month} ({m.n} transactions)</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={tables} onChange={e => setTables(e.target.checked)} /> Show data tables</label>
        </div>
      </div>
      <div className="viz-root">
        <Dashboard ins={ins} tables={tables} />
      </div>
    </section>
  );
}
