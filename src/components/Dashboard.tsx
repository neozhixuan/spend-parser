// Dashboard.tsx — the Insights view. Hand-built SVG/HTML, no chart library, no network.
// Colours follow a validated categorical palette: slot 1 (blue) = this month, slot 2 (orange) = last month.

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import type { Insights, Rec } from '../lib/insights.ts';

const money = (n: number) => 'S$' + Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => 'S$' + Math.round(Math.abs(n)).toLocaleString('en-SG');
const compact = (n: number) => (Math.abs(n) >= 1000 ? `S$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : `S$${Math.round(n)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
export const monthName = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleString('en-SG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function niceMax(v: number) {
  if (!(v > 0)) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

// Column with a 4px rounded data-end and a square baseline.
function colPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// ---------------------------------------------------------------- tooltip
interface TipRow { key?: string; value: string; label?: string }
interface TipApi { show(rows: TipRow[], x: number, y: number): void; hide(): void }
const TipContext = createContext<TipApi>({ show() {}, hide() {} });
const useTip = () => useContext(TipContext);

function TipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<{ rows: TipRow[]; x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const api = useMemo<TipApi>(() => ({ show: (rows, x, y) => setTip({ rows, x, y }), hide: () => setTip(null) }), []);
  useLayoutEffect(() => {
    const t = ref.current;
    if (!tip || !t) return;
    const pad = 12, w = t.offsetWidth, h = t.offsetHeight;
    t.style.left = `${Math.min(window.innerWidth - w - 8, tip.x + pad)}px`;
    t.style.top = `${Math.max(8, tip.y - h - pad)}px`;
  }, [tip]);
  return (
    <TipContext.Provider value={api}>
      {children}
      {tip && (
        <div ref={ref} className="viz-tip" role="status">
          {tip.rows.map((r, i) => (
            <div key={i} className="viz-tip-row">
              {r.key && <span className={`viz-key ${r.key}`} />}
              <strong>{r.value}</strong>
              {r.label && <span className="viz-tip-label">{r.label}</span>}
            </div>
          ))}
        </div>
      )}
    </TipContext.Provider>
  );
}

// Pointer and keyboard handlers that show a tooltip for one element.
function useTipHandlers(rows: () => TipRow[]) {
  const tip = useTip();
  return {
    onPointerMove: (e: PointerEvent) => tip.show(rows(), e.clientX, e.clientY),
    onPointerLeave: () => tip.hide(),
    onFocus: (e: FocusEvent<Element>) => { const b = e.currentTarget.getBoundingClientRect(); tip.show(rows(), b.left + b.width / 2, b.top); },
    onBlur: () => tip.hide(),
  };
}

// Width of a container, kept up to date as the layout changes.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------------------------------------------------------------- building blocks
function Card({ title, sub, span2, children }: { title: string; sub?: string; span2?: boolean; children: ReactNode }) {
  return (
    <div className={`viz-card${span2 ? ' span-2' : ''}`}>
      <div className="viz-head">
        <h3>{title}</h3>
        {sub && <span className="viz-sub">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { key: string; label: string }[] }) {
  return (
    <div className="viz-legend">
      {items.map(it => (
        <span key={it.label} className="viz-legend-item"><span className={`viz-key ${it.key}`} />{it.label}</span>
      ))}
    </div>
  );
}

function VizTable({ headers, rows, numeric = [] }: { headers: string[]; rows: string[][]; numeric?: number[] }) {
  const cls = (i: number) => (numeric.includes(i) ? 'num' : undefined);
  return (
    <div className="viz-table">
      <table>
        <thead><tr>{headers.map((h, i) => <th key={i} className={cls(i)}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, j) => <tr key={j}>{r.map((v, i) => <td key={i} className={cls(i)}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, hero, tone = '', arrow }: { label: string; value: string; sub?: string; hero?: boolean; tone?: string; arrow?: string }) {
  return (
    <div className={`viz-stat${hero ? ' hero' : ''}`}>
      <div className="viz-stat-label">{label}</div>
      <div className="viz-stat-value">{value}</div>
      {sub && (
        <div className={`viz-stat-sub ${tone}`}>
          {arrow && <span aria-hidden="true">{arrow + ' '}</span>}
          {sub}
        </div>
      )}
    </div>
  );
}

// Horizontal bars in HTML: crisp text at any width. One series, optional last-month tick.
interface BarItem { name: string; value: number; prev?: number | null; share?: number | null }

function HBar({ it, max, showPrev }: { it: BarItem; max: number; showPrev: boolean }) {
  const tip = useTipHandlers(() => [
    { key: 'bar s1', value: money(it.value), label: `${it.name}${it.share != null ? ` · ${pct(it.share)} of spending` : ''}` },
    ...(showPrev && it.prev != null ? [{ key: 'line s2', value: money(it.prev), label: 'last month' }] : []),
  ]);
  return (
    <div className="hbar" tabIndex={0} {...tip}>
      <span className="hb-label" title={it.name}>{it.name}</span>
      <span className="hb-track">
        <span className="hb-fill" style={{ width: `${(it.value / max) * 100}%` }} />
        {showPrev && it.prev! > 0 && <span className="hb-prev" style={{ left: `calc(${(it.prev! / max) * 100}% - 1px)` }} />}
      </span>
      <span className="hb-val">{money0(it.value)}</span>
    </div>
  );
}

function HBars({ items, showPrev = false }: { items: BarItem[]; showPrev?: boolean }) {
  const max = niceMax(Math.max(...items.map(i => Math.max(i.value, i.prev || 0)), 1));
  return <div className="hbars">{items.map(it => <HBar key={it.name} it={it} max={max} showPrev={showPrev} />)}</div>;
}

// Cumulative spending line: this month vs last month, crosshair tooltip.
function PaceChart({ ins }: { ins: Insights }) {
  const [host, width] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const tip = useTip();
  const cur = ins.kpis.inProgress ? ins.daily.slice(0, ins.kpis.elapsed) : ins.daily;
  const [day, setDay] = useState(cur.length);
  const [active, setActive] = useState(false);

  const W = Math.max(280, width || 520), H = 230;
  const m = { l: 52, r: 64, t: 10, b: 26 };
  const prev = ins.prevDaily;
  const n = Math.max(ins.daily.length, prev ? prev.length : 0);
  const ymax = niceMax(Math.max(...cur, ...(prev || [0]), 1));
  const x = (d: number) => m.l + ((d - 1) / Math.max(1, n - 1)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - v / ymax) * (H - m.t - m.b);
  const linePath = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // End dots + labels; drop last month's label if it would collide with this month's.
  const ends = [...(prev ? [{ arr: prev, cls: 's2' }] : []), { arr: cur, cls: 's1' }]
    .map(e => ({ ...e, px: x(e.arr.length), py: y(e.arr[e.arr.length - 1] || 0), v: e.arr[e.arr.length - 1] || 0 }));
  const collide = ends.length === 2 && Math.abs(ends[0].py - ends[1].py) < 14 && Math.abs(ends[0].px - ends[1].px) < 60;

  const show = (d: number, cx: number, cy: number) => {
    const dd = Math.max(1, Math.min(n, d));
    setDay(dd);
    setActive(true);
    const a = cur[dd - 1], b = prev ? prev[dd - 1] : undefined;
    const rows: TipRow[] = [{ value: `Day ${dd}`, label: '' }];
    if (a != null) rows.push({ key: 'line s1', value: money(a), label: monthName(ins.month) });
    if (b != null) rows.push({ key: 'line s2', value: money(b), label: monthName(ins.prevMonth) });
    tip.show(rows, cx, cy);
  };
  const off = () => { setActive(false); tip.hide(); };
  const box = () => svgRef.current!.getBoundingClientRect();
  const a = cur[day - 1], b = prev ? prev[day - 1] : undefined;

  return (
    <div className="viz-plot" ref={host}>
      {width > 0 && (
        <svg
          ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0}
          aria-label={`Cumulative spending by day of month: ${money(cur[cur.length - 1] || 0)} by day ${cur.length}${prev ? `, versus ${money(prev[prev.length - 1])} last month` : ''}.`}
          onFocus={() => { const r = box(); show(day, r.left + (x(day) / W) * r.width, r.top + 20); }}
          onBlur={off}
          onKeyDown={e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const r = box();
            const d = day + (e.key === 'ArrowRight' ? 1 : -1);
            show(d, r.left + (x(Math.max(1, Math.min(n, d))) / W) * r.width, r.top + 20);
          }}
        >
          {[0, 1, 2, 3, 4].map(i => {
            const v = (ymax / 4) * i;
            return (
              <g key={i}>
                <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className={i ? 'viz-grid' : 'viz-axis'} />
                <text x={m.l - 8} y={y(v) + 4} textAnchor="end" className="viz-tick">{compact(v)}</text>
              </g>
            );
          })}
          {[1, 8, 15, 22, n].map((d, i) => <text key={i} x={x(d)} y={H - 8} textAnchor="middle" className="viz-tick">{d}</text>)}
          {prev && <path d={linePath(prev)} className="viz-line s2" />}
          <path d={linePath(cur)} className="viz-line s1" />
          {ends.map(e => (
            <g key={e.cls}>
              <circle cx={e.px} cy={e.py} r={4} className={`viz-dot ${e.cls}`} />
              {!(collide && e.cls === 's2') && <text x={e.px + 8} y={e.py + 4} className="viz-endlabel">{compact(e.v)}</text>}
            </g>
          ))}
          {active && <line x1={x(day)} x2={x(day)} y1={m.t} y2={H - m.b} className="viz-cross" />}
          {active && b != null && <circle cx={x(day)} cy={y(b)} r={4} className="viz-dot s2" />}
          {active && a != null && <circle cx={x(day)} cy={y(a)} r={4} className="viz-dot s1" />}
          <rect
            x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} fill="transparent"
            onPointerMove={e => {
              const r = box();
              const px = ((e.clientX - r.left) / r.width) * W;
              show(Math.round(1 + ((px - m.l) / (W - m.l - m.r)) * (n - 1)), e.clientX, e.clientY);
            }}
            onPointerLeave={off}
          />
        </svg>
      )}
    </div>
  );
}

// Vertical columns, one or two series on the same S$ scale.
interface Series { name: string; values: number[]; cls: string }

function Column({ c, sr, v, bx, barW, top, h, colH }: { c: string; sr: Series; v: number; bx: number; barW: number; top: number; h: number; colH: number }) {
  const tip = useTipHandlers(() => [{ key: `bar ${sr.cls}`, value: money(v), label: `${c} · ${sr.name}` }]);
  return (
    <g className="viz-col" tabIndex={0} aria-label={`${c} ${sr.name}: ${money(v)}`} {...tip}>
      <rect x={bx - 2} y={top} width={barW + 4} height={colH} fill="transparent" />
      {h > 0 && <path d={colPath(bx, top + colH - h, barW, h)} className={`viz-fill ${sr.cls}`} />}
    </g>
  );
}

function Columns({ cats, series, labelMax = true }: { cats: string[]; series: Series[]; labelMax?: boolean }) {
  const [host, width] = useWidth<HTMLDivElement>();
  const W = Math.max(260, width || 400), H = 190;
  const m = { l: 48, r: 8, t: 18, b: 24 };
  const ymax = niceMax(Math.max(1, ...series.flatMap(sr => sr.values)));
  const band = (W - m.l - m.r) / cats.length;
  const barW = Math.min(24, (band - 8) / series.length - 2);
  const y = (v: number) => m.t + (1 - v / ymax) * (H - m.t - m.b);
  const maxIdx = series[0].values.indexOf(Math.max(...series[0].values));
  const groupW = series.length * barW + (series.length - 1) * 2;
  return (
    <div className="viz-plot" ref={host}>
      {width > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={series.map(sr => `${sr.name}: ${cats.map((c, i) => `${c} ${money0(sr.values[i])}`).join(', ')}`).join('; ')}>
          {[0, 1, 2, 3, 4].map(i => {
            const v = (ymax / 4) * i;
            return (
              <g key={i}>
                <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className={i ? 'viz-grid' : 'viz-axis'} />
                {i % 2 === 0 && <text x={m.l - 8} y={y(v) + 4} textAnchor="end" className="viz-tick">{compact(v)}</text>}
              </g>
            );
          })}
          {cats.map((c, i) => {
            const gx = m.l + band * i + (band - groupW) / 2;
            return (
              <g key={c}>
                {series.map((sr, k) => {
                  const v = sr.values[i];
                  const bx = gx + k * (barW + 2);
                  const h = Math.max(0, (H - m.t - m.b) * (v / ymax));
                  return (
                    <g key={sr.name}>
                      <Column c={c} sr={sr} v={v} bx={bx} barW={barW} top={m.t} h={h} colH={H - m.t - m.b} />
                      {labelMax && k === 0 && i === maxIdx && v > 0 && <text x={bx + barW / 2} y={y(v) - 5} textAnchor="middle" className="viz-endlabel">{compact(v)}</text>}
                    </g>
                  );
                })}
                <text x={m.l + band * i + band / 2} y={H - 6} textAnchor="middle" className="viz-tick">{c}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

const REC_ICON = { good: '✓', warning: '!', critical: '!', info: 'i' };
const REC_WORD = { good: 'Good', warning: 'Watch', critical: 'Alert', info: 'Note' };

function RecList({ recs }: { recs: Rec[] }) {
  return (
    <ul className="recs">
      {recs.map((r, i) => (
        <li key={i} className={`rec ${r.level}`}>
          <span className="rec-badge">
            <span className="rec-icon" aria-hidden="true">{REC_ICON[r.level]}</span>
            <span className="rec-word">{REC_WORD[r.level]}</span>
          </span>
          <div>
            <div className="rec-title">{r.title}</div>
            <div className="rec-detail">{r.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- main
export function Dashboard({ ins, tables }: { ins: Insights; tables: boolean }) {
  const k = ins.kpis;

  let deltaSub = k.inProgress ? `${k.elapsed} of ${k.days} days so far` : monthName(ins.month);
  let tone = '', arrow = '';
  if (k.prevSpend != null) {
    const d = k.spend - k.prevSpend;
    deltaSub = `${money0(d)} ${d >= 0 ? 'more' : 'less'} than last month`;
    tone = d > 0 ? 'bad' : 'good';
    arrow = d > 0 ? '▲' : '▼';
  }

  const cats: BarItem[] = ins.categories.slice(0, 9);
  const other = ins.categories.slice(9);
  if (other.length) cats.push({ name: `Other (${other.length})`, value: other.reduce((s, c) => s + c.value, 0), prev: ins.comparable ? other.reduce((s, c) => s + (c.prev || 0), 0) : null, share: other.reduce((s, c) => s + c.share, 0) });

  return (
    <TipProvider>
      <div className="viz-stats">
        <Stat label="Spent" value={money0(k.spend)} sub={deltaSub} hero tone={tone} arrow={arrow} />
        <Stat label="Came in" value={money0(k.income)} sub="salary, interest, payouts, money received" />
        <Stat label="Left over" value={(k.net < 0 ? '−' : '') + money0(k.net)} sub={k.savingsRate != null ? `${pct(k.savingsRate)} of income` : 'no income this month'} tone={k.net < 0 ? 'bad' : ''} />
        <Stat label="Per day" value={money(k.perDay)} sub={`over ${k.elapsed} days`} />
        <Stat label="Purchases" value={String(k.count)} sub={k.count ? `avg ${money(k.spend / k.count)}` : ''} />
      </div>

      <div className="viz-grid-2">
        <Card title="Observations" sub="generated from your data in this tab" span2>
          <RecList recs={ins.recs} />
          <p className="viz-note">Simple rules applied to your transactions — a prompt to look closer, not financial advice.</p>
        </Card>

        <Card title="Where it went" sub={`${monthName(ins.month)} · transfers excluded`}>
          {ins.comparable && <Legend items={[{ key: 'bar s1', label: 'This month' }, { key: 'tick s2', label: 'Last month' }]} />}
          {cats.length ? <HBars items={cats} showPrev={ins.comparable} /> : <p className="viz-note">No spending this month.</p>}
          {tables && (
            <VizTable
              headers={['Category', 'This month', 'Share', ...(ins.comparable ? ['Last month'] : [])]}
              rows={ins.categories.map(c => [c.name, money(c.value), pct(c.share), ...(ins.comparable ? [money(c.prev || 0)] : [])])}
              numeric={[1, 2, 3]}
            />
          )}
        </Card>

        <Card title="Spending pace" sub="running total by day of month">
          {ins.prevDaily && <Legend items={[{ key: 'line s1', label: monthName(ins.month) }, { key: 'line s2', label: monthName(ins.prevMonth) }]} />}
          <PaceChart key={ins.month} ins={ins} />
          {tables && (
            <VizTable
              headers={['Day', 'This month', ...(ins.prevDaily ? ['Last month'] : [])]}
              rows={ins.daily.map((v, i) => [String(i + 1), money(v), ...(ins.prevDaily ? [ins.prevDaily[i] != null ? money(ins.prevDaily[i]) : '—'] : [])])}
              numeric={[1, 2]}
            />
          )}
        </Card>

        <Card title="Top merchants" sub="by total spent">
          <VizTable headers={['Merchant', 'Category', 'Times', 'Total']} rows={ins.merchants.slice(0, 8).map(mm => [mm.name, mm.category, String(mm.count), money(mm.total)])} numeric={[2, 3]} />
        </Card>

        <Card title="By day of week" sub="total spent on each weekday">
          <Columns cats={ins.dow.map(d => d.name)} series={[{ name: 'Spent', values: ins.dow.map(d => d.value), cls: 's1' }]} />
          {tables && <VizTable headers={['Day', 'Spent', 'Purchases']} rows={ins.dow.map(d => [d.name, money(d.value), String(d.count)])} numeric={[1, 2]} />}
          {ins.byAccount.length > 1 && (
            <>
              <h4 className="viz-subhead">Paid from</h4>
              <HBars items={ins.byAccount.map(a => ({ ...a, share: k.spend ? a.value / k.spend : null }))} />
            </>
          )}
        </Card>

        {ins.monthly.length >= 2 && (
          <Card title="Month by month" sub="only as complete as the statements you have loaded" span2>
            <Legend items={[{ key: 'bar s1', label: 'Spent' }, { key: 'bar s2', label: 'Came in' }]} />
            <Columns
              cats={ins.monthly.map(mm => mm.month)}
              series={[
                { name: 'Spent', values: ins.monthly.map(mm => mm.spend), cls: 's1' },
                { name: 'Came in', values: ins.monthly.map(mm => mm.income), cls: 's2' },
              ]}
              labelMax={false}
            />
            {tables && <VizTable headers={['Month', 'Spent', 'Came in']} rows={ins.monthly.map(mm => [mm.month, money(mm.spend), money(mm.income)])} numeric={[1, 2]} />}
          </Card>
        )}
      </div>
    </TipProvider>
  );
}
