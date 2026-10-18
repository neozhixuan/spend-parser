// parsers.ts — pure statement-parsing logic, shared by the browser app and the Node test harness.
// Input: a pdf.js PDFDocumentProxy. Output: { bank, transactions, checks, issues, pages }.
// Nothing here touches the network or the DOM.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BankId, Chunk, IssueLevel, Line, Page, ParseResult, Txn } from './types.ts';

const MON: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const MON_RE = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';
const AMT_RE = /^\(?-?(?:S?\$)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?$/;
const pad = (n: number | string) => String(n).padStart(2, '0');
const r2 = (n: number) => Math.round(n * 100) / 100;
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
export const fmt = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const monthOf = (name: string) => MON[name.slice(0, 3).toUpperCase()];

export function parseAmount(s: string): number {
  const neg = /^\(.*\)$/.test(s) || s.trim().startsWith('-');
  const v = Number(s.replace(/[^\d.]/g, ''));
  return neg ? -v : v;
}

// Mask any token carrying 6+ digits (account numbers, refs, phone numbers) before it can reach the sheet.
export function sanitise(s: string): string {
  return s
    .split(/\s+/)
    .map(tok => ((tok.match(/\d/g) || []).length >= 6 ? '•••' : tok))
    .join(' ')
    .replace(/(•••\s*)+/g, '••• ')
    .trim();
}

// A parsed row before it gets an ID and a category.
function newTxn(t: Pick<Txn, 'date' | 'account' | 'description' | 'merchant' | 'amount' | 'source'>): Txn {
  return { ...t, id: '', category: 'Uncategorised', kind: t.amount < 0 ? 'expense' : 'income' };
}

// ---------------------------------------------------------------------------
// 1. Positional text extraction: pages → lines → chunks (runs of adjacent text)
// ---------------------------------------------------------------------------
interface Item { str: string; x: number; xEnd: number; y: number; h: number }

export async function extractPages(pdf: PDFDocumentProxy): Promise<Page[]> {
  const pages: Page[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: Item[] = [];
    let rotated = 0;
    for (const it of tc.items) {
      if (!('str' in it) || typeof it.str !== 'string' || !it.str.trim()) continue;
      const [, b, c, d, e, f] = it.transform as number[];
      if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01) { rotated++; continue; } // vertical margin text (reg. numbers)
      const h = Math.abs(d) || it.height || 8;
      items.push({ str: it.str, x: e, xEnd: e + (it.width || 0), y: vp.height - f, h });
    }
    items.sort((a, b2) => a.y - b2.y || a.x - b2.x);

    const raw: { y: number; h: number; items: Item[] }[] = [];
    for (const it of items) {
      const last = raw[raw.length - 1];
      if (last && Math.abs(last.y - it.y) <= Math.max(2, 0.35 * Math.min(last.h, it.h))) last.items.push(it);
      else raw.push({ y: it.y, h: it.h, items: [it] });
    }

    const lines: Line[] = raw.map(l => {
      l.items.sort((a, b2) => a.x - b2.x);
      const chunks: Chunk[] = [];
      for (const it of l.items) {
        const prev = chunks[chunks.length - 1];
        const gap = prev ? it.x - prev.xEnd : Infinity;
        if (prev && gap < 0.35 * Math.max(prev.h, it.h)) {
          const needSpace = gap > 0.1 * it.h && !/\s$/.test(prev.str) && !/^\s/.test(it.str);
          prev.str += (needSpace ? ' ' : '') + it.str;
          prev.xEnd = Math.max(prev.xEnd, it.xEnd);
        } else {
          chunks.push({ str: it.str, x: it.x, xEnd: it.xEnd, h: it.h, cx: 0 });
        }
      }
      for (const c of chunks) { c.str = c.str.replace(/\s+/g, ' ').trim(); c.cx = (c.x + c.xEnd) / 2; }
      const kept = chunks.filter(c => c.str);
      return { page: p, y: Math.round(l.y * 10) / 10, chunks: kept, text: kept.map(c => c.str).join(' '), tag: '' };
    });
    pages.push({ page: p, width: vp.width, height: vp.height, rotatedItems: rotated, lines });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// 2. Bank detection
// ---------------------------------------------------------------------------
export const BANK_LABELS: Record<BankId, string> = { paylah: 'DBS PayLah!', posb: 'POSB / DBS consolidated', sc: 'Standard Chartered', singlife: 'Singlife' };
export const bankLabel = (bank: BankId | null | undefined) => (bank ? BANK_LABELS[bank] : undefined);

export function detectBank(pages: Page[]): BankId | null {
  const head = pages.slice(0, 2).flatMap(p => p.lines.map(l => l.text)).join('\n');
  const first = (pages[0]?.lines || []).map(l => l.text).join('\n');
  const all = pages.flatMap(p => p.lines.map(l => l.text)).join('\n');
  if (/PayLah/i.test(head) && /WALLET ACCOUNT/i.test(head)) return 'paylah';
  if (/Consolidated Statement/i.test(first) && /(POSB|DBS)/.test(head)) return 'posb';
  if (/Standard Chartered Bank \(Singapore\)/i.test(all) || (/standard\s*chartered/i.test(head) && /Statement of Account/i.test(head))) return 'sc';
  if (/(POSB|DBS)/.test(head) && /Balance Brought Forward/i.test(all) && /Withdrawal/i.test(all)) return 'posb';
  if (/Singlife/i.test(all)) return 'singlife';
  return null;
}

// ---------------------------------------------------------------------------
// 3. Generic running-balance table parser (POSB/DBS, Standard Chartered)
// ---------------------------------------------------------------------------
const SKIP_RE = /\bPage \d+ of \d+\b|Transaction Details as (of|at)\b|^PDS_|serves as a tax invoice|Co\.? Reg\.? No|GST Reg|GST Group Registration|Reg\. Add|Reg\. No\.|\bBank \(Singapore\) Limited\b/i;

type ColKey = 'w' | 'd' | 'b';
type Amounts = Record<ColKey, number | null>;
interface Header { cols: { key: ColKey; cx: number }[]; amtZone: number }

interface TableCfg {
  defaultSection: string;
  dateRe: RegExp;
  toISO(m: RegExpExecArray): string;
  openingRe: RegExp;
  closingRe: RegExp;
  stopRe: RegExp | null;
  sectionOf?(line: Line): string | null;
  capsSections?: boolean;
  capsCandidate?(line: Line): string | null;
  newAccountRe?: RegExp;
  cleanDesc(lines: string[]): string[];
  merchantOf(lines: string[]): string;
}

function headerOf(line: Line): Header | null {
  const find = (re: RegExp) => line.chunks.find(c => re.test(c.str));
  const w = find(/^withdrawals?\b/i), d = find(/^deposits?\b/i), b = find(/^balance\b/i);
  if (!w || !d || !b || !/\bdate\b/i.test(line.text)) return null;
  const cols = ([{ key: 'w', cx: w.cx }, { key: 'd', cx: d.cx }, { key: 'b', cx: b.cx }] as Header['cols']).sort((a, c) => a.cx - c.cx);
  const amtZone = cols[0].cx - 0.75 * (cols[1].cx - cols[0].cx);
  return { cols, amtZone };
}

function splitLine(line: Line, hdr: Header, dateRe: RegExp | null) {
  const amts: Amounts = { w: null, d: null, b: null };
  const descParts: string[] = [];
  const extras: string[] = [];
  let dateMatch: RegExpExecArray | null = null;
  for (const [i, c] of line.chunks.entries()) {
    let str = c.str;
    if (i === 0 && dateRe && c.cx < hdr.amtZone) {
      const m = dateRe.exec(str);
      if (m) { dateMatch = m; str = str.slice(m[0].length).trim(); if (!str) continue; }
    }
    if (AMT_RE.test(str) && c.cx > hdr.amtZone) {
      let best = hdr.cols[0];
      for (const col of hdr.cols) if (Math.abs(col.cx - c.cx) < Math.abs(best.cx - c.cx)) best = col;
      if (amts[best.key] == null) amts[best.key] = parseAmount(str); else extras.push(str);
      continue;
    }
    descParts.push(str);
  }
  return { dateMatch, desc: descParts.join(' ').trim(), amts, extras };
}

const lastAmount = (line: Line) => {
  for (let i = line.chunks.length - 1; i >= 0; i--) if (AMT_RE.test(line.chunks[i].str)) return parseAmount(line.chunks[i].str);
  return null;
};

interface Row { date: string; desc: string[]; amts: Amounts; lines: Line[]; page: number }

function parseBalanceTable(pages: Page[], cfg: TableCfg, out: ParseResult) {
  const st = {
    section: null as string | null, hdr: null as Header | null, balance: null as number | null, cur: null as Row | null,
    sumW: 0, sumD: 0, opened: false, sectionTxns: 0, verified: 0, closed: false,
    candidate: null as string | null, pending: null as string | null, stopped: false, page: 0,
  };
  const log = (level: IssueLevel, line: Line | null, msg: string) => out.issues.push({ level, page: line?.page, text: line?.text, msg });
  const check = (ok: boolean, label: string, detail: string, line: Line) => {
    out.checks.push({ ok, label, detail, page: line?.page });
    if (!ok) log('error', line, `Check failed — ${label}: ${detail}`);
  };

  const resetSection = (name: string) => {
    closeSection();
    Object.assign(st, { section: name, balance: null, sumW: 0, sumD: 0, opened: false, sectionTxns: 0, verified: 0, closed: false });
  };

  function closeSection() {
    if (st.section && st.sectionTxns > 0) {
      const lvl = st.verified === st.sectionTxns ? 'info' : 'warn';
      out.issues.push({ level: lvl, msg: `${st.section}: ${st.verified} of ${st.sectionTxns} rows reconciled against the printed running balance.` });
    }
    if (st.section && st.sectionTxns > 0 && !st.closed) {
      out.issues.push({ level: 'info', msg: `${st.section}: no "Total … Carried Forward" line found, so withdrawal/deposit totals could not be cross-checked (final running balance ${fmt(st.balance)}).` });
    }
  }

  function opening(line: Line, amts: Amounts) {
    line.tag = 'open';
    const val = amts.b ?? lastAmount(line);
    if (val == null) { log('error', line, 'Opening/brought-forward balance line has no readable amount'); return; }
    if (st.balance != null && !eq(st.balance, val)) {
      log('error', line, `Balance brought forward ${fmt(val)} ≠ running balance ${fmt(st.balance)} from the previous page — a row was probably missed or misread just before this point.`);
    }
    st.opened = true;
    st.balance = val;
  }

  function closing(line: Line, amts: Amounts) {
    line.tag = 'close';
    const bal = amts.b ?? lastAmount(line);
    const name = st.section || 'Account';
    if (bal != null && st.balance != null) check(eq(bal, st.balance), `${name} closing balance`, `statement shows ${fmt(bal)}, computed ${fmt(st.balance)}`, line);
    if (/total/i.test(line.text)) {
      if (amts.w != null) check(eq(amts.w, st.sumW), `${name} total withdrawals`, `statement ${fmt(amts.w)}, parsed rows sum to ${fmt(st.sumW)}`, line);
      if (amts.d != null) check(eq(amts.d, st.sumD), `${name} total deposits`, `statement ${fmt(amts.d)}, parsed rows sum to ${fmt(st.sumD)}`, line);
      st.closed = true;
    }
    if (bal != null) {
      st.balance = bal;
      const acct = st.section || cfg.defaultSection;
      out.balances = out.balances.filter(b => b.account !== acct).concat({ account: acct, closing: bal });
    }
  }

  function flush() {
    const c = st.cur;
    if (!c) return;
    st.cur = null;
    const { w, d, b } = c.amts;
    const L = c.lines[0];
    if (w == null && d == null) { log('error', L, `Row dated ${c.date} has no withdrawal or deposit amount — NOT imported.`); return; }
    if (w != null && d != null) { log('error', L, `Row dated ${c.date} has both a withdrawal (${fmt(w)}) and a deposit (${fmt(d)}) — NOT imported.`); return; }
    let amount = d != null ? d : -(w as number);
    if (b != null && st.balance != null) {
      if (eq(r2(st.balance + amount), b) || eq(r2(st.balance - amount), b)) st.verified++;
      if (!eq(r2(st.balance + amount), b)) {
        if (eq(r2(st.balance - amount), b)) {
          log('warn', L, `${fmt(Math.abs(amount))} sat in the ${amount > 0 ? 'Deposit' : 'Withdrawal'} column by position, but the running balance only works the other way — sign flipped to match the balance.`);
          amount = -amount;
        } else {
          log('error', L, `Running balance mismatch: ${fmt(st.balance)} ${amount < 0 ? '−' : '+'} ${fmt(Math.abs(amount))} = ${fmt(r2(st.balance + amount))}, but the statement shows ${fmt(b)}. A row above may be missing or misread. Imported anyway — please verify.`);
        }
      }
    } else if (st.balance == null) {
      log('warn', L, 'No opening balance seen before this row, so its amount could not be verified against the running balance.');
    }
    if (amount < 0) st.sumW = r2(st.sumW - amount); else st.sumD = r2(st.sumD + amount);
    st.balance = b != null ? b : st.balance != null ? r2(st.balance + amount) : null;
    const descLines = cfg.cleanDesc(c.desc.filter(Boolean));
    out.transactions.push(newTxn({
      date: c.date,
      account: st.section || cfg.defaultSection,
      description: descLines.join(' | '),
      merchant: cfg.merchantOf(descLines).replace(/[\s:;,\-|]+$/, ''),
      amount: r2(amount),
      source: { page: c.page, text: c.lines.map(l => l.text).join(' ⏎ ') },
    }));
    st.sectionTxns++;
  }

  for (const pg of pages) {
    if (st.page !== pg.page) { flush(); st.page = pg.page; }
    for (const line of pg.lines) {
      if (st.stopped) { line.tag = 'ignored'; continue; }
      const t = line.text;
      if (cfg.stopRe && cfg.stopRe.test(t)) { flush(); st.stopped = true; line.tag = 'stop'; continue; }
      if (SKIP_RE.test(t)) { line.tag = 'skip'; continue; }

      // Explicit section headers (POSB: "POSB Everyday Savings Account   Account No. …")
      const sec = cfg.sectionOf?.(line);
      if (sec) {
        flush();
        if (sec === st.section) { line.tag = 'section-cont'; } else { resetSection(sec); line.tag = 'section'; }
        st.hdr = null;
        continue;
      }

      const hdr = headerOf(line);
      if (hdr) {
        flush();
        st.hdr = hdr;
        line.tag = 'header';
        if (cfg.capsSections) { st.pending = st.candidate && st.candidate !== st.section ? st.candidate : null; st.candidate = null; }
        continue;
      }

      if (cfg.capsSections && !st.cur) {
        const cand = cfg.capsCandidate?.(line);
        if (cand) { st.candidate = cand; line.tag = 'caps'; continue; }
      }

      if (!st.hdr) { line.tag = 'outside'; continue; }

      const { dateMatch, desc, amts } = splitLine(line, st.hdr, cfg.dateRe);
      const hasAmt = amts.w != null || amts.d != null || amts.b != null;

      if (dateMatch) {
        flush();
        if (cfg.openingRe.test(desc)) {
          // A pending caps heading only starts a new account if this is a genuine statement opening,
          // not a page-break "brought forward" (which keeps the current account).
          if (cfg.capsSections) {
            if (!st.section || (st.pending && cfg.newAccountRe?.test(desc))) resetSection(st.pending || cfg.defaultSection);
            else if (st.pending) out.issues.push({ level: 'info', page: line.page, text: line.text, msg: `Ignored heading "${st.pending}" — the table that follows continues ${st.section}.` });
            st.pending = null;
          }
          opening(line, amts);
          continue;
        }
        if (cfg.closingRe.test(desc)) { closing(line, amts); continue; }
        if (cfg.capsSections) {
          if (!st.section) resetSection(st.pending || cfg.defaultSection);
          st.pending = null;
        }
        st.cur = { date: cfg.toISO(dateMatch), desc: [desc], amts: { ...amts }, lines: [line], page: pg.page };
        line.tag = 'row';
        continue;
      }
      if (cfg.openingRe.test(t)) { flush(); opening(line, amts); continue; }
      if (cfg.closingRe.test(t)) { flush(); closing(line, amts); continue; }

      if (st.cur) {
        // A line far below the row it would continue (e.g. a page footer) is not part of that row.
        const last = st.cur.lines[st.cur.lines.length - 1];
        if (!hasAmt && last.page === line.page && line.y - last.y > Math.max(30, 4 * (line.chunks[0]?.h || 8))) {
          flush();
          line.tag = 'unparsed';
          continue;
        }
        if (hasAmt) {
          for (const k of ['w', 'd', 'b'] as const) {
            const v = amts[k];
            if (v == null) continue;
            if (st.cur.amts[k] == null) st.cur.amts[k] = v;
            else log('warn', line, `Extra ${({ w: 'withdrawal', d: 'deposit', b: 'balance' })[k]} amount ${fmt(v)} on a continuation line was ignored.`);
          }
        }
        if (desc) st.cur.desc.push(desc);
        st.cur.lines.push(line);
        line.tag = 'cont';
        continue;
      }
      line.tag = 'unparsed';
      if (hasAmt) log('warn', line, 'Line with amounts inside a transaction table did not match any known row pattern — skipped.');
    }
  }
  flush();
  closeSection();
  // Sections with no closing line still have a usable final running balance.
  const section = st.section, balance = st.balance;
  if (section && balance != null && !out.balances.some(b => b.account === section)) {
    out.balances = out.balances.concat({ account: section, closing: balance });
  }
}

// ---------------------------------------------------------------------------
// 3a. POSB / DBS consolidated statement
// ---------------------------------------------------------------------------
const POSB_GENERIC = /^(Point-of-Sale Transaction|FAST Payment \/ Receipt|Payments \/ Collections via GIRO|Funds Transfer|Debit Card Transaction|Advice.*|Bill Payment|Salary|Inward Credit.*|Cash Withdrawal.*|Interbank GIRO|Monthly Savings Amount.*|Remittance.*|Top-?up.*|NETS.*)$/i;

const POSB_CFG: TableCfg = {
  defaultSection: 'POSB/DBS',
  dateRe: /^(\d{2})\/(\d{2})\/(\d{4})/,
  toISO: m => `${m[3]}-${m[2]}-${m[1]}`,
  openingRe: /Balance Brought Forward/i,
  closingRe: /Balance Carried Forward/i,
  stopRe: /^Messages For You/i,
  sectionOf(line) {
    const m = /^(.+?)\s+Account No\.?/i.exec(line.text);
    if (!m) return null;
    const label = m[1].trim();
    if (/^account$/i.test(label) || label.length < 6) return null;
    return label.replace(/\s+Account$/i, '');
  },
  cleanDesc: lines => lines.filter(l => !/^OTHER$/i.test(l)).map(sanitise).filter(l => l && l !== '•••'),
  merchantOf(lines) {
    const tf = lines.find(l => /^(TO|FROM)\s*(MSA)?\s*:/i.test(l));
    if (tf) {
      const v = tf.replace(/^(TO|FROM)\s*(MSA)?\s*:\s*/i, '').replace(/•••/g, '').trim();
      if (v) return v;
    }
    if (POSB_GENERIC.test(lines[0] || '') && lines[1]) return lines[1].replace(/•••/g, '').trim() || lines[0];
    return (lines[0] || '').replace(/•••/g, '').trim();
  },
};

// ---------------------------------------------------------------------------
// 3b. Standard Chartered (JumpStart and similar deposit accounts)
// ---------------------------------------------------------------------------
const SC_BOILERPLATE = /^(STATEMENT OF ACCOUNT|STATEMENT DATE|BRANCH|DATE|DESCRIPTION|DEPOSIT|WITHDRAWAL|BALANCE|SINGAPORE.*|IMPORTANT.*|NOTES?)$/i;

const ADDRESS_RE = /\b(BLK|BLOCK|CRESCENT|ROAD|RD|AVENUE|AVE|STREET|ST|DRIVE|DR|LANE|CLOSE|WALK|RISE|PLACE|TERRACE|LINK|CENTRAL|SINGAPORE)\b|#\d/;

function makeScCfg(customerName: string | undefined, headerCutoffY: number): TableCfg {
  return {
    defaultSection: 'SC Account',
    capsSections: true,
    dateRe: new RegExp(`^(\\d{1,2})\\s+${MON_RE}\\s+(\\d{4})`, 'i'),
    toISO: m => `${m[3]}-${pad(monthOf(m[2]))}-${pad(m[1])}`,
    openingRe: /BALANCE (FROM PREVIOUS STATEMENT|BROUGHT FORWARD|B\/F)/i,
    newAccountRe: /PREVIOUS STATEMENT/i,
    closingRe: /(BALANCE CARRIED FORWARD|CLOSING BALANCE|BALANCE C\/F)/i,
    stopRe: null,
    capsCandidate(line) {
      // Never take a heading from the name/address block at the top of page 1.
      if (line.page === 1 && line.y < headerCutoffY) return null;
      // The account heading is the left-most chunk; the account number / "(SGD)" sit far to the right.
      const t = (line.chunks[0]?.str || '').replace(/\s*[\d•*Xx\-]{4,}.*$/, '').replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();
      if (ADDRESS_RE.test(t)) return null;
      if (!/^[A-Z][A-Z0-9 &$'\-]{2,40}$/.test(t)) return null;
      if (/\d{2}/.test(t) || SC_BOILERPLATE.test(t)) return null;
      if (customerName && t === customerName) return null;
      return 'SC ' + t.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase());
    },
    cleanDesc(lines) {
      const out: string[] = [];
      lines.forEach((l, i) => {
        let s = l;
        if (i === 0) s = s.replace(/^\d{2}\/\d{2}\s*/, '');
        if (/^VALUE DATE/i.test(s)) return;
        const fx = /^([A-Z]{3})\s+([\d,]+\.\d{2})$/.exec(s);
        if (fx) { if (fx[1] !== 'SGD') out.push(`(${fx[1]} ${fx[2]})`); return; }
        s = sanitise(s);
        if (s && s !== '•••') out.push(s);
      });
      return out;
    },
    merchantOf: lines => (lines[0] || '').replace(/•••/g, '').trim(),
  };
}

// ---------------------------------------------------------------------------
// 4. DBS PayLah! (single amount column with DB/CR suffix, no running balance)
// ---------------------------------------------------------------------------
function parsePayLah(pages: Page[], out: ParseResult) {
  const log = (level: IssueLevel, line: Line | null, msg: string) => out.issues.push({ level, page: line?.page, text: line?.text, msg });
  const lines = pages.flatMap(p => p.lines);
  const dateRe = new RegExp(`(\\d{1,2})\\s+${MON_RE}\\s+(\\d{4})`, 'i');
  let stmt: { m: number; y: number } | null = null;
  for (const l of lines) {
    const m = dateRe.exec(l.text);
    if (m) { stmt = { m: monthOf(m[2]), y: +m[3] }; break; }
  }
  if (!stmt) log('error', null, 'Could not find the statement date, so transaction years are unknown. Rows will be dated with the current year.');
  const year = (mon: number) => (stmt ? stmt.y - (mon > stmt.m ? 1 : 0) : new Date().getFullYear());

  const rowRe = new RegExp(`^(\\d{1,2})\\s+${MON_RE}\\b\\s*(.*)$`, 'i');
  const amtRe = /([\d,]+\.\d{2})\s*(DB|CR)\s*$/i;
  type PayRow = { date: string; desc: string[]; amount: number | null; lines: Line[]; page: number };
  let inTable = false, cur: PayRow | null = null, opening: number | null = null, closing: number | null = null, sum = 0, n = 0;

  const flush = () => {
    if (!cur) return;
    const c: PayRow = cur; cur = null;
    if (c.amount == null) { log('error', c.lines[0], `Row dated ${c.date} has no amount with a DB/CR marker — NOT imported.`); return; }
    const desc = c.desc.map(sanitise).filter(s => s && s !== '•••');
    sum = r2(sum + c.amount); n++;
    out.transactions.push(newTxn({
      date: c.date, account: 'PayLah', description: desc.join(' | '),
      merchant: (desc[0] || '').replace(/•••/g, '').trim(), amount: c.amount,
      source: { page: c.page, text: c.lines.map(l => l.text).join(' ⏎ ') },
    }));
  };

  for (const line of lines) {
    const t = line.text;
    if (/^DATE\s+DESCRIPTION\b.*AMOUNT/i.test(t)) { inTable = true; line.tag = 'header'; continue; }
    if (!inTable) { line.tag = 'outside'; continue; }
    if (/USEFUL INFORMATION|^Important Notice/i.test(t)) { flush(); inTable = false; line.tag = 'stop'; continue; }
    if (SKIP_RE.test(t)) { line.tag = 'skip'; continue; }
    const am = amtRe.exec(t);
    const signed = am ? r2(parseAmount(am[1]) * (am[2].toUpperCase() === 'CR' ? 1 : -1)) : null;
    if (/PREVIOUS BALANCE/i.test(t)) { flush(); opening = signed; line.tag = 'open'; if (signed == null) log('error', line, 'Previous balance has no readable amount.'); continue; }
    if (/Carried Forward/i.test(t)) { flush(); closing = signed; line.tag = 'close'; continue; }
    const dm = rowRe.exec(t);
    if (dm) {
      flush();
      const mon = monthOf(dm[2]);
      cur = { date: `${year(mon)}-${pad(mon)}-${pad(dm[1])}`, desc: [dm[3].replace(amtRe, '').trim()], amount: signed, lines: [line], page: line.page };
      line.tag = 'row';
      continue;
    }
    // `cur` is assigned inside flush() too, which control-flow analysis can't see.
    const row = cur as PayRow | null;
    if (row) {
      if (/^REF NO/i.test(t)) { line.tag = 'ref'; row.lines.push(line); continue; }
      if (am && row.amount == null) row.amount = signed;
      const rest = t.replace(amtRe, '').trim();
      if (rest) row.desc.push(rest);
      row.lines.push(line);
      line.tag = 'cont';
      continue;
    }
    if (/^PayLah!? Wallet$/i.test(t)) { line.tag = 'section'; continue; }
    line.tag = 'unparsed';
    if (am) log('warn', line, 'Line with a DB/CR amount did not match the row pattern — skipped.');
  }
  flush();

  if (!lines.some(l => l.tag === 'header')) log('error', null, 'Never found the "DATE  DESCRIPTION  AMOUNT" table header — layout may have changed. Use "Inspect lines" to see what was extracted.');
  if (closing != null) out.balances = [{ account: 'PayLah', closing }];
  if (opening != null && closing != null) {
    const ok = eq(r2(opening + sum), closing);
    out.checks.push({ ok, label: 'PayLah balance reconciliation', detail: `previous ${fmt(opening)} + net ${fmt(sum)} = ${fmt(r2(opening + sum))}; statement carried forward ${fmt(closing)}` });
    if (!ok) log('error', null, `PayLah balances don't reconcile: previous ${fmt(opening)} + parsed rows ${fmt(sum)} = ${fmt(r2(opening + sum))}, but statement says ${fmt(closing)}. A row was missed or misread.`);
  } else if (n) {
    log('warn', null, 'Missing PREVIOUS BALANCE or Carried Forward line — PayLah totals could not be reconciled.');
  }
}

// ---------------------------------------------------------------------------
// 5. Entry point
// ---------------------------------------------------------------------------
export const emptyResult = (fileName = ''): ParseResult => ({ fileName, bank: null, transactions: [], checks: [], issues: [], pages: [], balances: [] });

export async function parseStatement(pdf: PDFDocumentProxy, fileName = ''): Promise<ParseResult> {
  const out = emptyResult(fileName);
  try {
    out.pages = await extractPages(pdf);
  } catch (e) {
    out.issues.push({ level: 'error', msg: `Could not read text from the PDF: ${(e as Error).message}` });
    return out;
  }
  const textLines = out.pages.reduce((n, p) => n + p.lines.length, 0);
  if (!textLines) {
    out.issues.push({ level: 'error', msg: 'The PDF has no text layer (it is probably a scan or a photo). Download the e-statement PDF from the bank instead — OCR is not supported.' });
    return out;
  }
  const bank = detectBank(out.pages);
  out.bank = bank;
  try {
    if (bank === 'paylah') parsePayLah(out.pages, out);
    else if (bank === 'posb') parseBalanceTable(out.pages, POSB_CFG, out);
    else if (bank === 'sc') {
      // The customer's name is the first all-caps chunk near the top of page 1; never treat it as an account heading.
      const p1 = (out.pages[0]?.lines || []).filter(l => l.y < 220).flatMap(l => l.chunks);
      const nameChunk = p1.find(c => /^[A-Z][A-Z' \-]{3,40}$/.test(c.str) && /\s/.test(c.str) && !SC_BOILERPLATE.test(c.str));
      const hdrYs = (out.pages[0]?.lines || []).filter(l => /Statement Date|Branch/i.test(l.text)).map(l => l.y);
      const cutoff = hdrYs.length ? Math.max(...hdrYs) + 40 : 0;
      parseBalanceTable(out.pages, makeScCfg(nameChunk?.str, cutoff), out);
    } else if (bank === 'singlife') {
      out.issues.push({ level: 'error', msg: 'Recognised a Singlife statement, but there is no Singlife parser yet. Send a censored sample so one can be added.' });
    } else {
      const sample = out.pages[0].lines.slice(0, 15).map(l => l.text).join(' / ');
      out.issues.push({ level: 'error', msg: `Could not tell which bank this statement is from. First lines read: "${sample.slice(0, 300)}…"` });
    }
  } catch (e) {
    out.issues.push({ level: 'error', msg: `Parser crashed: ${(e as Error).message}`, text: (e as Error).stack });
  }
  if (bank && bank !== 'singlife' && !out.transactions.length) {
    out.issues.push({ level: 'warn', msg: 'Parsed the statement but found zero transactions. If you expected some, the layout probably changed — check "Inspect lines".' });
  }
  const errs = out.issues.filter(i => i.level === 'error').length;
  out.issues.unshift({ level: 'info', msg: `Detected ${bankLabel(bank) || 'unknown format'} · ${out.pages.length} pages · ${out.transactions.length} transactions · ${out.checks.filter(c => c.ok).length}/${out.checks.length} checks passed · ${errs} errors` });
  return out;
}
