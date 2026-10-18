// categorise.ts — rules engine, internal-transfer matching and stable transaction IDs.
// Rules are tried in order: your own rules first, then the defaults. First match wins.
// kind: 'expense' | 'income' | 'transfer' (transfers are excluded from spending totals).
// sign: optional 'in' (amount > 0) or 'out' (amount < 0) restriction.

import type { Rule, Txn } from './types.ts';

export const DEFAULT_RULES: Rule[] = [
  // --- money moving between your own accounts ---
  { match: 'MONTHLY SAVINGS AMOUNT|MYSAVINGS|\\bSAYE\\b', category: 'Internal transfer', kind: 'transfer' },
  { match: 'TOP-?\\s?UP.{0,15}PAYLAH|PAYLAH.{0,15}TOP-?\\s?UP|TOP UP FROM (POSB|DBS)', category: 'Internal transfer', kind: 'transfer' },
  { match: 'CREDIT CARD|CARD PAYMENT|PAYMENT - THANK YOU|PAYMENT RECEIVED', category: 'Card bill payment', kind: 'transfer' },
  { match: 'SINGLIFE', category: 'Internal transfer', kind: 'transfer' },
  { match: '\\bTO (POSB|DBS|SC|STANDARD CHARTERED)\\b|\\bFROM (POSB|DBS|SC|STANDARD CHARTERED)\\b', category: 'Internal transfer', kind: 'transfer' },

  // --- income ---
  { match: '^SALARY|\\bSALARY\\b', category: 'Salary', kind: 'income', sign: 'in' },
  { match: 'INTEREST (EARNED|CREDIT)|BONUS INTEREST', category: 'Interest', kind: 'income', sign: 'in' },
  { match: 'CASHBACK|REBATE', category: 'Cashback', kind: 'income', sign: 'in' },
  { match: 'GIRO.*\\bGOV\\b|\\bGOV\\b.*\\bGOV\\b|CDC VOUCHER|GST VOUCHER|MOF\\b|IRAS REFUND', category: 'Government payout', kind: 'income', sign: 'in' },
  { match: 'INCOMING PAYNOW|RECEIVE MONEY FROM|\\bFROM:', category: 'Money received', kind: 'income', sign: 'in' },

  // --- spending ---
  { match: 'GRABFOOD|GRAB\\*?\\s*FOOD|FOODPANDA|DELIVEROO', category: 'Food delivery', kind: 'expense' },
  { match: 'TRANSIT|SIMPLYGO|BUS/MRT|EZ-?LINK|\\bGRAB\\b|GRAB\\*|GOJEK|\\bTADA\\b|\\bRYDE\\b|COMFORT|CDG ZIG|\\bZIG\\b', category: 'Transport', kind: 'expense' },
  { match: 'FAIRPRICE|NTUC|COLD STORAGE|SHENG SIONG|\\bGIANT\\b|DON DON DONKI|DONKI|REDMART|PRIME SUPERMARKET', category: 'Groceries', kind: 'expense' },
  { match: 'FOOD|KOPI|COFFEE|CAFE|RESTAURANT|BAKERY|HAWKER|MCDONALD|\\bKFC\\b|STARBUCKS|TOAST BOX|YA KUN|BURGER|SUBWAY|SUSHI|\\bLIHO\\b|KOI THE|CHICHA|MIXUE|MR BEAN|EATERY|KITCHEN|NOODLE|CHICKEN RICE', category: 'Food & drinks', kind: 'expense' },
  { match: 'SHOPEE|LAZADA|AMAZON|TAOBAO|UNIQLO|IKEA|DECATHLON|QOO10|ALIEXPRESS|\\bTEMU\\b|COURTS|HARVEY NORMAN|CHALLENGER', category: 'Shopping', kind: 'expense' },
  { match: 'NETFLIX|SPOTIFY|APPLE\\.COM|ITUNES|YOUTUBE|DISNEY|ICLOUD|OPENAI|ANTHROPIC|CLAUDE\\.AI|GOOGLE \\*|CHATGPT', category: 'Subscriptions', kind: 'expense' },
  { match: 'SINGTEL|STARHUB|\\bM1\\b|CIRCLES|GOMO|SIMBA|SP DIGITAL|SP SERVICES|SP GROUP|GENECO|SENOKO|TUAS POWER|PUB\\b', category: 'Bills & utilities', kind: 'expense' },
  { match: 'GUARDIAN|WATSONS|UNITY|CLINIC|POLYCLINIC|HOSPITAL|DENTAL|PHARMACY', category: 'Health', kind: 'expense' },
  { match: 'GOLDEN VILLAGE|\\bGV\\b|SHAW THEATRES|CATHAY|KLOOK|STEAM|PLAYSTATION|NINTENDO', category: 'Entertainment', kind: 'expense' },
  { match: 'ACTIVESG|ANYTIME FITNESS|\\bGYM\\b|CLASSPASS|FITNESS', category: 'Fitness', kind: 'expense' },
  { match: 'AIRLINES|AIRWAYS|SCOOT|JETSTAR|AGODA|BOOKING\\.COM|AIRBNB|TRIP\\.COM|EXPEDIA', category: 'Travel', kind: 'expense' },
  { match: 'PAYNOW.*\\bTO\\b|SEND MONEY TO|TRANSFER TO|FAST PAYMENT', category: 'Sent to others', kind: 'expense', sign: 'out' },
];

export const BASE_CATEGORIES = ['Uncategorised', 'Reimbursement'];

const compiled = new Map<string, RegExp | null>();
function re(src: string): RegExp | null {
  if (!compiled.has(src)) {
    try { compiled.set(src, new RegExp(src, 'i')); } catch { compiled.set(src, null); }
  }
  return compiled.get(src) ?? null;
}

function ruleMatches(rule: Rule, t: Txn): boolean {
  if (rule.sign === 'in' && t.amount <= 0) return false;
  if (rule.sign === 'out' && t.amount >= 0) return false;
  if (rule.account && !(re(rule.account)?.test(t.account))) return false;
  const target = rule.field === 'merchant' ? t.merchant : `${t.merchant} | ${t.description}`;
  return !!re(rule.match)?.test(target);
}

export function categorise(txns: Txn[], userRules: Rule[] = [], defaults: Rule[] = DEFAULT_RULES): Txn[] {
  const rules = [...userRules, ...defaults];
  for (const t of txns) {
    if (t.manual || t.saved) continue;
    t.matchedWith = null;
    const hit = rules.find(r => ruleMatches(r, t));
    if (hit) { t.category = hit.category; t.kind = hit.kind; t.rule = hit.match; }
    else { t.category = 'Uncategorised'; t.kind = t.amount < 0 ? 'expense' : 'income'; t.rule = null; }
  }
  return txns;
}

// Pair a debit in one account with an equal credit in another within 3 days.
// Applies when at least one side already looks like a transfer, or both are uncategorised.
export function matchTransfers(txns: Txn[], maxDays = 3): number {
  const day = (d: string) => Date.parse(d + 'T00:00:00Z') / 86400000;
  const eligible = (t: Txn) => !t.manual && !t.saved && !t.matchedWith && (t.kind === 'transfer' || t.category === 'Uncategorised' || t.category === 'Money received' || t.category === 'Sent to others');
  const outs = txns.filter(t => t.amount < 0 && eligible(t));
  let pairs = 0;
  for (const o of outs) {
    if (o.matchedWith) continue;
    const cands = txns.filter(i => i.amount > 0 && eligible(i) && i.account !== o.account &&
      Math.abs(i.amount + o.amount) < 0.005 && Math.abs(day(i.date) - day(o.date)) <= maxDays);
    const strong = cands.find(i => i.kind === 'transfer' || o.kind === 'transfer') ||
      cands.find(i => i.category === 'Uncategorised' && o.category === 'Uncategorised');
    if (!strong) continue;
    for (const t of [o, strong]) { t.category = 'Internal transfer'; t.kind = 'transfer'; }
    o.matchedWith = strong.id || `${strong.account} ${strong.date}`;
    strong.matchedWith = o.id || `${o.account} ${o.date}`;
    pairs++;
  }
  return pairs;
}

// Normalised merchant string → used as a rule key when you re-categorise something.
export function merchantKey(m: string | undefined): string {
  return (m || '')
    .toUpperCase()
    .replace(/•••/g, ' ')
    .replace(/\*\s*\S+$/, '*')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Stable ID: same transaction in two overlapping statements → same ID, so Sheets de-dupes it.
export async function assignIds(txns: Txn[]): Promise<Txn[]> {
  const seen = new Map<string, number>();
  for (const t of txns) {
    const base = `${t.account}|${t.date}|${t.amount.toFixed(2)}|${t.description}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const bytes = new TextEncoder().encode(`${base}|${n}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    t.id = [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return txns;
}
