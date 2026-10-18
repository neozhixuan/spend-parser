// insights.ts — turns categorised transactions into dashboard numbers and plain-language observations.
// Pure functions: no DOM, no network. Everything stays in the browser.

import type { Balance, Txn } from './types.ts';

export type RecLevel = 'good' | 'warning' | 'critical' | 'info';
export interface Rec { level: RecLevel; title: string; detail: string; weight: number }
export interface CategoryStat { name: string; value: number; prev: number | null; share: number }
export interface MerchantStat { name: string; total: number; count: number; category: string; amounts: number[] }
export interface DayStat { name: string; value: number; count: number }
export interface Kpis {
  spend: number; prevSpend: number | null; income: number; net: number; savingsRate: number | null;
  perDay: number; count: number; elapsed: number; days: number; inProgress: boolean;
}
export interface Insights {
  month: string; prevMonth: string; comparable: boolean; kpis: Kpis;
  categories: CategoryStat[]; merchants: MerchantStat[]; dow: DayStat[];
  byAccount: { name: string; value: number }[];
  monthly: { month: string; spend: number; income: number }[];
  daily: number[]; prevDaily: number[] | null; recs: Rec[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const daysIn = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
const money = (n: number) => 'S$' + Math.abs(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n: number) => 'S$' + Math.round(Math.abs(n)).toLocaleString('en-SG');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RIDE_HAIL = /\bGRAB\b|GRAB\*|GOJEK|\bTADA\b|\bRYDE\b|\bZIG\b|COMFORT|CDG/i;
const PUBLIC_TRANSIT = /TRANSIT|SIMPLYGO|BUS\/MRT|EZ-?LINK/i;

export function monthsIn(txns: Txn[]): { month: string; n: number }[] {
  const count: Record<string, number> = {};
  for (const t of txns) count[t.date.slice(0, 7)] = (count[t.date.slice(0, 7)] || 0) + 1;
  return Object.entries(count).sort((a, b) => a[0].localeCompare(b[0])).map(([month, n]) => ({ month, n }));
}

// Default to the latest month that looks complete: at least half as many transactions as the busiest month.
// (Statement periods rarely align to calendar months, so the first/last month is often a partial stub.)
export function defaultMonth(txns: Txn[]): string | null {
  const ms = monthsIn(txns);
  if (!ms.length) return null;
  const max = Math.max(...ms.map(m => m.n));
  return [...ms].reverse().find(m => m.n >= 0.5 * max)!.month;
}

function spendOf(list: Txn[]) { return r2(list.filter(t => t.kind === 'expense').reduce((s, t) => s - t.amount, 0)); }
function incomeOf(list: Txn[]) { return r2(list.filter(t => t.kind === 'income').reduce((s, t) => s + t.amount, 0)); }

function groupSpend(list: Txn[], keyFn: (t: Txn) => string) {
  const out: Record<string, number> = {};
  for (const t of list) if (t.kind === 'expense') { const k = keyFn(t); out[k] = r2((out[k] || 0) - t.amount); }
  return out;
}

function cumulative(list: Txn[], ym: string) {
  const n = daysIn(ym);
  const perDay = new Array<number>(n).fill(0);
  for (const t of list) if (t.kind === 'expense') perDay[+t.date.slice(8, 10) - 1] -= t.amount;
  let run = 0;
  return perDay.map(v => (run = r2(run + v)));
}

/**
 * @param txns categorised transactions
 * @param month 'YYYY-MM'
 * @param balances latest closing balance per account from the parsed statements
 * @param today used to tell whether the month is still in progress
 */
export function computeInsights(txns: Txn[], month: string, balances: Balance[] = [], today = new Date()): Insights {
  const pm = prevMonth(month);
  const cur = txns.filter(t => t.date.startsWith(month));
  const prev = txns.filter(t => t.date.startsWith(pm));
  const spend = spendOf(cur), prevSpend = spendOf(prev);
  const income = incomeOf(cur);
  const todayYm = today.toISOString().slice(0, 7);
  const elapsed = month === todayYm ? today.getDate() : daysIn(month);
  // Only compare months when last month looks similarly complete (partial statement periods would mislead).
  const comparable = prev.length >= 0.6 * cur.length && prevSpend > 0;

  const byCategory = groupSpend(cur, t => t.category);
  const prevByCategory = groupSpend(prev, t => t.category);
  const categories = Object.entries(byCategory).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value, prev: comparable ? prevByCategory[name] || 0 : null, share: spend ? value / spend : 0 }));

  const merchantMap: Record<string, MerchantStat> = {};
  for (const t of cur) {
    if (t.kind !== 'expense') continue;
    const key = (t.merchant || t.description || 'Unknown').toUpperCase();
    const m = (merchantMap[key] ||= { name: t.merchant || t.description || 'Unknown', total: 0, count: 0, category: t.category, amounts: [] });
    m.total = r2(m.total - t.amount); m.count++; m.amounts.push(-t.amount);
  }
  const merchants = Object.values(merchantMap).sort((a, b) => b.total - a.total);

  const dow: DayStat[] = DOW.map(d => ({ name: d, value: 0, count: 0 }));
  for (const t of cur) if (t.kind === 'expense') {
    const i = (new Date(t.date + 'T00:00:00Z').getUTCDay() + 6) % 7;
    dow[i].value = r2(dow[i].value - t.amount); dow[i].count++;
  }

  const byAccount = Object.entries(groupSpend(cur, t => t.account)).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const monthly = monthsIn(txns).map(({ month: m }) => ({ month: m, spend: spendOf(txns.filter(t => t.date.startsWith(m))), income: incomeOf(txns.filter(t => t.date.startsWith(m))) }));

  const kpis: Kpis = {
    spend, prevSpend: comparable ? prevSpend : null,
    income, net: r2(income - spend), savingsRate: income > 0 ? (income - spend) / income : null,
    perDay: r2(spend / Math.max(1, elapsed)), count: cur.filter(t => t.kind === 'expense').length,
    elapsed, days: daysIn(month), inProgress: month === todayYm,
  };

  const recs = buildRecs({ cur, spend, income, kpis, categories, merchants, dow, balances, comparable });
  return { month, prevMonth: pm, comparable, kpis, categories, merchants, dow, byAccount, monthly,
    daily: cumulative(cur, month), prevDaily: comparable ? cumulative(prev, pm) : null, recs };
}

interface RecInput {
  cur: Txn[]; spend: number; income: number; kpis: Kpis; categories: CategoryStat[];
  merchants: MerchantStat[]; dow: DayStat[]; balances: Balance[]; comparable: boolean;
}

function buildRecs({ cur, spend, income, kpis, categories, merchants, dow, balances, comparable }: RecInput): Rec[] {
  const recs: Rec[] = [];
  const add = (level: RecLevel, title: string, detail: string, weight: number) => recs.push({ level, title, detail, weight });
  const expenses = cur.filter(t => t.kind === 'expense');
  if (!expenses.length) return [{ level: 'info', title: 'No spending recorded for this month', detail: 'Load the statements that cover it.', weight: 0 }];

  // 1. Savings rate
  if (kpis.savingsRate != null) {
    const r = kpis.savingsRate;
    if (r >= 0.2) add('good', `You kept ${pct(r)} of what came in`, `${money(income)} in, ${money(spend)} spent — ${money(kpis.net)} left over. A common rule of thumb is to save at least 20%.`, 95);
    else if (r >= 0) add('warning', `You kept ${pct(r)} of what came in`, `${money(income)} in, ${money(spend)} spent. Below the 20% many budgeting guides aim for — the categories below show where it went.`, 90);
    else add('critical', `Spending exceeded income by ${money(-kpis.net)}`, `${money(spend)} spent vs ${money(income)} in. Check whether a large one-off or a mis-categorised transfer is inflating spending.`, 100);
  }

  // 2. Biggest category
  const top = categories[0];
  if (top && top.share >= 0.25) add('info', `${top.name} is ${pct(top.share)} of your spending`, `${money(top.value)} this month${categories[1] ? `, more than ${categories[1].name} (${money(categories[1].value)})` : ''}.`, 55);

  // 3. Month-over-month movers
  if (comparable) {
    const movers = categories.filter(c => c.prev != null).map(c => ({ ...c, prev: c.prev as number, delta: c.value - (c.prev as number) }))
      .filter(c => Math.abs(c.delta) >= 50 && (c.prev === 0 || Math.abs(c.delta) / c.prev >= 0.25))
      .sort((a, b) => b.delta - a.delta);
    const up = movers.find(c => c.delta > 0), down = [...movers].reverse().find(c => c.delta < 0);
    if (up) add('warning', `${up.name} up ${money0(up.delta)} on last month`, `${money(up.value)} vs ${money(up.prev)}.`, 80);
    if (down) add('good', `${down.name} down ${money0(-down.delta)} on last month`, `${money(down.value)} vs ${money(down.prev)}.`, 50);
  } else {
    add('info', 'Load last month to see month-over-month changes', 'Last month has too few transactions loaded to compare fairly (statement periods often start mid-month).', 5);
  }

  // 4. Subscriptions
  const subs = merchants.filter(m => m.category === 'Subscriptions');
  if (subs.length) {
    const total = subs.reduce((s, m) => s + m.total, 0);
    add('info', `Subscriptions: ${money(total)}/month ≈ ${money0(total * 12)}/year`, `${subs.map(m => `${m.name} (${money(m.total)})`).join(', ')}. Worth checking each one still earns its keep.`, 65);
  }

  // 5. Small frequent purchases
  const small = merchants.filter(m => m.count >= 4 && Math.max(...m.amounts) <= 20);
  if (small.length) {
    const total = small.reduce((s, m) => s + m.total, 0);
    const n = small.reduce((s, m) => s + m.count, 0);
    add('info', `${n} small purchases added up to ${money(total)}`, `${small.slice(0, 4).map(m => `${m.name} ×${m.count}`).join(', ')}. At this pace that's about ${money0(total * 12)} a year.`, 45);
  }

  // 6. Food delivery vs eating out
  const delivery = categories.find(c => c.name === 'Food delivery')?.value || 0;
  const food = categories.find(c => c.name === 'Food & drinks')?.value || 0;
  if (delivery >= 30 && delivery / (delivery + food) >= 0.3) add('warning', `Delivery is ${pct(delivery / (delivery + food))} of your food spending`, `${money(delivery)} on delivery vs ${money(food)} on food & drinks. Delivery fees and markups usually make the same meal noticeably dearer.`, 70);

  // 7. Ride-hailing vs public transport
  const ride = expenses.filter(t => RIDE_HAIL.test(`${t.merchant} ${t.description}`) && t.category === 'Transport').reduce((s, t) => s - t.amount, 0);
  const transit = expenses.filter(t => PUBLIC_TRANSIT.test(`${t.merchant} ${t.description}`)).reduce((s, t) => s - t.amount, 0);
  if (ride >= 50 && ride > 2 * transit) add('info', `Ride-hailing cost ${money(ride)} vs ${money(transit)} on public transport`, 'Swapping even a few rides a week for MRT/bus is usually the easiest transport saving.', 60);

  // 8. Weekend share
  const weekend = dow[5].value + dow[6].value;
  if (spend > 0 && weekend / spend >= 0.45) add('info', `${pct(weekend / spend)} of spending happened on weekends`, `${money(weekend)} on Saturdays and Sundays.`, 35);

  // 9. Largest one-offs
  const big = [...expenses].sort((a, b) => a.amount - b.amount).slice(0, 3).filter(t => -t.amount >= Math.max(100, spend * 0.08));
  if (big.length) add('info', `Largest single payments`, big.map(t => `${t.merchant || t.description} ${money(t.amount)} (${t.date.slice(5)})`).join(' · ') + ' — check these are expenses, not transfers to yourself.', 40);

  // 10. Idle cash earning little (one observation covering every low-yield account)
  const idle: (Balance & { interest: number; yieldPa: number })[] = [];
  for (const b of balances) {
    if (!(b.closing >= 5000)) continue;
    const interest = cur.filter(t => t.account === b.account && t.kind === 'income' && /INTEREST/i.test(`${t.merchant} ${t.description}`)).reduce((s, t) => s + t.amount, 0);
    if (interest <= 0) continue;
    const yieldPa = (interest * 12) / b.closing;
    if (yieldPa < 0.01) idle.push({ ...b, interest, yieldPa });
  }
  if (idle.length) {
    const total = idle.reduce((s, b) => s + b.closing, 0);
    const interest = idle.reduce((s, b) => s + b.interest, 0);
    add('info', `~${money0(total)} in savings earned ${money(interest)} interest this month`,
      `${idle.map(b => `${b.account} ~${money0(b.closing)} at about ${(b.yieldPa * 100).toFixed(2)}% a year`).join('; ')}. If part of this isn't needed day-to-day, bonus-interest savings accounts, T-bills and Singapore Savings Bonds currently pay considerably more — worth comparing.`, 75);
  }

  // 11. Data quality
  const uncat = expenses.filter(t => t.category === 'Uncategorised');
  if (uncat.length) {
    const amt = uncat.reduce((s, t) => s - t.amount, 0);
    if (amt / spend >= 0.1) add('warning', `${uncat.length} transactions (${money(amt)}) are uncategorised`, 'Categorise them in the review table so these insights reflect your real spending.', 85);
  }

  return recs.sort((a, b) => b.weight - a.weight);
}
