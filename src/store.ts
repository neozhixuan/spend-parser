// store.ts — the app's state and every action that changes it.
// Transactions are mutated in place by the rules engine and the tracker sync (just like the parsers expect),
// so React subscribes to a version number that bumps after each change instead of comparing objects.

import { useSyncExternalStore } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseStatement, emptyResult, bankLabel } from './lib/parsers.ts';
import { categorise, matchTransfers, DEFAULT_RULES, BASE_CATEGORIES, merchantKey, escapeRe, assignIds } from './lib/categorise.ts';
import { signIn, signOut, currentSession, findSpreadsheet, createSpreadsheet, loadAll, saveAll, HEADER, ApiError } from './lib/sheets.ts';
import type { Balance, IssueLevel, Kind, ParseResult, Rule, Txn } from './lib/types.ts';
import { GOOGLE_CLIENT_ID } from './config.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// ---------------------------------------------------------------- persistence (this browser only)
const local = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem('sp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem('sp.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

export interface FileEntry { key: number; name: string; status: 'parsing' | 'done'; result: ParseResult | null }
interface LogItem { level: IssueLevel | 'ok'; file: string; msg: string; page?: number; text?: string }
interface SheetLogLine { time: string; msg: string; cls: string; link?: string }

export const state = {
  files: [] as FileEntry[],
  txns: [] as Txn[],
  dupes: 0,
  rules: local.get<Rule[]>('rules', []),
  rulesDirty: false,
  remember: local.get('remember', true),
  month: null as string | null,
  monthPinned: false,
  history: [] as Txn[],          // transactions loaded from your tracker spreadsheet
  historyBalances: [] as Balance[],
  alreadySaved: 0,
  email: null as string | null,
  sheetId: null as string | null,
  busy: false,
  status: { msg: '', cls: '' },
  sheetLog: [] as SheetLogLine[],
  toast: null as string | null,
  clientIdTyped: GOOGLE_CLIENT_ID ? '' : local.get('clientIdTyped', ''),
  sheetIdOverride: '',
  showExport: false,             // forced open when sign-in needs a client ID
  showAdvanced: false,
};

// ---------------------------------------------------------------- React binding
let version = 0;
const listeners = new Set<() => void>();
function emit() { version++; listeners.forEach(l => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function useStore(): typeof state {
  useSyncExternalStore(subscribe, () => version);
  return state;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  state.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; emit(); }, 3200);
  emit();
}

// ---------------------------------------------------------------- loading PDFs
async function openPdf(data: Uint8Array, name: string) {
  let password: string | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // data.slice(): pdf.js transfers (detaches) the buffer it is given, so retries need a fresh copy.
      return await pdfjs.getDocument({ data: data.slice(), password, verbosity: 0 }).promise;
    } catch (e) {
      const err = e as Error | undefined;
      if (err?.name === 'PasswordException') {
        const typed = prompt(`"${name}" is password-protected${attempt ? ' — that password was wrong, try again' : ''}.\nThe password stays in this tab and is not saved.`);
        if (typed == null) throw new Error('Password-protected PDF and no password entered — skipped.');
        password = typed;
        continue;
      }
      throw new Error(`pdf.js could not open the file (${err?.name || 'Error'}): ${err?.message || e}`);
    }
  }
  throw new Error('Wrong password entered too many times — skipped.');
}

let fileKey = 0;
export async function handleFiles(list: File[]) {
  for (const file of list) {
    const entry: FileEntry = { key: ++fileKey, name: file.name, status: 'parsing', result: null };
    state.files.push(entry);
    emit();
    try {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Not a PDF file.');
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await openPdf(data, file.name);
      entry.result = await parseStatement(pdf, file.name);
      await assignIds(entry.result.transactions);
      try { await pdf.loadingTask.destroy(); } catch { /* best effort */ }
    } catch (e) {
      entry.result = { ...emptyResult(file.name), issues: [{ level: 'error', msg: (e as Error).message }] };
    }
    entry.status = 'done';
    rebuild();
  }
}

export function removeFile(key: number) {
  state.files = state.files.filter(f => f.key !== key);
  rebuild();
}

function rebuild() {
  const prev = new Map(state.txns.map(t => [t.id, t]));
  const seen = new Set(state.history.map(t => t.id));
  state.txns = [...state.history];
  state.dupes = 0;
  state.alreadySaved = 0;
  for (const f of state.files) {
    for (const t0 of f.result?.transactions || []) {
      if (seen.has(t0.id)) { if (state.history.some(h => h.id === t0.id)) state.alreadySaved++; else state.dupes++; continue; }
      seen.add(t0.id);
      const t: Txn = { ...t0, file: f.name };
      const p = prev.get(t.id);
      if (p?.manual) Object.assign(t, { category: p.category, kind: p.kind, manual: true });
      state.txns.push(t);
    }
  }
  state.txns.sort((a, b) => a.date.localeCompare(b.date) || a.account.localeCompare(b.account));
  recategorise();
}

function recategorise() {
  categorise(state.txns, state.rules, DEFAULT_RULES);
  matchTransfers(state.txns);
  emit();
}

// ---------------------------------------------------------------- categories & rules
export function allCategories(): string[] {
  const set = new Set([...BASE_CATEGORIES, 'Internal transfer']);
  for (const r of [...state.rules, ...DEFAULT_RULES]) set.add(r.category);
  for (const t of state.txns) set.add(t.category);
  return [...set].sort((a, b) => (a === 'Uncategorised' ? -1 : b === 'Uncategorised' ? 1 : a.localeCompare(b)));
}

function kindFor(category: string, t: Txn): Kind {
  if (category === 'Reimbursement') return 'expense';          // positive amount offsets spending
  if (category === 'Internal transfer' || category === 'Card bill payment') return 'transfer';
  if (category === 'Uncategorised') return t.amount < 0 ? 'expense' : 'income';
  const r = [...state.rules, ...DEFAULT_RULES].find(x => x.category === category);
  return r ? r.kind : t.amount < 0 ? 'expense' : 'income';
}

function saveRules() { local.set('rules', state.rules); state.rulesDirty = true; }

export function setRemember(on: boolean) { state.remember = on; local.set('remember', on); emit(); }

export function setCategory(id: string, category: string) {
  const t = state.txns.find(x => x.id === id);
  if (!t) return;
  t.category = category;
  t.kind = kindFor(category, t);
  t.manual = true;
  if (t.saved) t.dirty = true;
  if (state.remember) {
    const key = merchantKey(t.merchant);
    if (key.length >= 3) {
      const match = escapeRe(key);
      state.rules = state.rules.filter(r => !(r.field === 'merchant' && r.match === match));
      state.rules.unshift({ match, field: 'merchant', category, kind: t.kind });
      saveRules();
      const before = state.txns.filter(x => x.category === category).length;
      recategorise();
      const n = state.txns.filter(x => x.category === category).length - before;
      toast(`Rule added: ${key} → ${category}${n > 0 ? ` (applied to ${n} more)` : ''}`);
      return;
    }
  }
  emit();
}

export function setKind(id: string, kind: Kind) {
  const t = state.txns.find(x => x.id === id);
  if (!t) return;
  t.kind = kind; t.manual = true;
  if (t.saved) t.dirty = true;
  emit();
}

export function deleteRule(i: number) {
  state.rules = state.rules.filter((_, j) => j !== i);
  saveRules();
  recategorise();
}

export async function importRules(f: File) {
  try {
    const rules = JSON.parse(await f.text());
    if (!Array.isArray(rules) || !rules.every(r => r.match && r.category && r.kind)) throw new Error('Expected an array of {match, category, kind}');
    state.rules = rules;
    saveRules();
    recategorise();
    toast(`Imported ${rules.length} rules`);
  } catch (err) { toast(`Could not import rules: ${(err as Error).message}`); }
}

export function setMonth(month: string) { state.month = month; state.monthPinned = true; emit(); }

// ---------------------------------------------------------------- derived data
export function fileStats(r: ParseResult) {
  const errors = r.issues.filter(i => i.level === 'error').length;
  const warns = r.issues.filter(i => i.level === 'warn').length;
  const okChecks = r.checks.filter(c => c.ok).length;
  return { errors, warns, okChecks, totalChecks: r.checks.length };
}

export function collectIssues(): LogItem[] {
  const out: LogItem[] = [];
  for (const f of state.files) {
    if (!f.result) continue;
    for (const i of f.result.issues) out.push({ ...i, file: f.name });
    for (const c of f.result.checks) if (c.ok) out.push({ level: 'ok', file: f.name, page: c.page, msg: `✓ ${c.label}: ${c.detail}` });
  }
  if (state.alreadySaved) out.push({ level: 'info', file: '(all files)', msg: `${state.alreadySaved} transaction(s) in these files are already in your tracker and were skipped.` });
  if (state.dupes) out.push({ level: 'info', file: '(all files)', msg: `${state.dupes} transaction(s) appeared in more than one file and were counted once.` });
  return out;
}

export function latestBalances(): Balance[] {
  const map = new Map(state.historyBalances.map(b => [b.account, b]));
  for (const f of state.files) {
    const r = f.result;
    for (const b of r?.balances || []) {
      const dates = r!.transactions.filter(t => t.account === b.account).map(t => t.date).sort();
      const updated = dates[dates.length - 1] || new Date().toISOString().slice(0, 10);
      const old = map.get(b.account);
      if (!old || !old.updated || updated >= old.updated) map.set(b.account, { account: b.account, closing: b.closing, updated });
    }
  }
  return [...map.values()];
}

export function unsavedCounts() {
  return {
    fresh: state.txns.filter(t => !t.saved).length,
    edited: state.txns.filter(t => t.saved && t.dirty).length,
    rules: state.rulesDirty,
  };
}

// ---------------------------------------------------------------- downloads
function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

function logText(mask: boolean) {
  const m = (s: unknown) => (mask ? String(s ?? '').replace(/\d/g, '0') : String(s ?? ''));
  const out = [`Spending Parser log — ${new Date().toISOString()}${mask ? ' — DIGITS MASKED' : ''}`, ''];
  for (const f of state.files) {
    const r = f.result;
    if (!r) continue;
    out.push(`## ${mask ? 'file' : f.name}  [${bankLabel(r.bank) || 'unrecognised'}]`);
    for (const i of r.issues) out.push(`  [${i.level}] p${i.page ?? '-'} ${m(i.msg)}${i.text ? `\n      line: ${m(i.text)}` : ''}`);
    for (const c of r.checks) out.push(`  ${c.ok ? 'OK ' : 'FAIL'} ${c.label}: ${m(c.detail)}`);
    if (mask) {
      out.push('  -- extracted lines (x positions of chunks in brackets) --');
      for (const p of r.pages) for (const l of p.lines) out.push(`  p${p.page} y${Math.round(l.y)} [${l.tag || '-'}] ${l.chunks.map(c => `${m(c.str)}@${Math.round(c.x)}`).join('  ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}
export const downloadLog = () => download(`parse-log-${stamp()}.txt`, logText(false));
export const downloadDebug = () => download(`debug-masked-${stamp()}.txt`, logText(true));

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  // Guard text against spreadsheet formula injection, but never touch plain numbers like -7.80.
  if (typeof v === 'string' && /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function exportCsv() {
  const rows = [HEADER, ...state.txns.map(t => [t.id, t.date, t.date.slice(0, 7), t.account, t.merchant, t.description, t.amount.toFixed(2), t.category, t.kind])];
  download(`spending-${stamp()}.csv`, rows.map(r => r.map(csvCell).join(',')).join('\n'), 'text/csv');
}
export const exportRules = () => download('rules.json', JSON.stringify(state.rules, null, 2), 'application/json');

// ---------------------------------------------------------------- Google Sheets
export const clientId = () => GOOGLE_CLIENT_ID || state.clientIdTyped.trim();
export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`;
export const isSignedIn = () => !!(state.email && currentSession());
const setStatus = (msg: string, cls = '') => { state.status = { msg, cls }; emit(); };
const setBusy = (busy: boolean) => { state.busy = busy; emit(); };

export function setClientIdTyped(v: string) { state.clientIdTyped = v; emit(); }
export function setSheetIdOverride(v: string) { state.sheetIdOverride = v; emit(); }
export function setShowAdvanced(open: boolean) { if (state.showAdvanced !== open) { state.showAdvanced = open; emit(); } }

export async function doSignIn(): Promise<boolean> {
  if (!clientId()) {
    state.showExport = true;
    state.showAdvanced = true;
    setStatus('No Google Client ID configured. Set GOOGLE_CLIENT_ID in src/config.ts, or open Export → Advanced and paste it.', 'error');
    return false;
  }
  setBusy(true);
  try {
    setStatus('Signing in…');
    const s = await signIn(clientId(), { hint: state.email || undefined });
    state.email = s.email;
    local.set('clientIdTyped', GOOGLE_CLIENT_ID ? '' : clientId());
    setStatus('Looking for your tracker…');
    const override = state.sheetIdOverride.trim();
    let id: string | null = override || local.get<string | null>(`sheet:${s.email}`, null);
    let data = null;
    if (id) {
      try { data = await loadAll(id); } catch (e) { if (override || !(e instanceof ApiError && [403, 404].includes(e.status))) throw e; id = null; }
    }
    if (!id) {
      id = await findSpreadsheet();
      if (id) data = await loadAll(id);
    }
    state.sheetId = id;
    if (id) local.set(`sheet:${s.email}`, id);
    if (data) {
      state.history = data.transactions;
      state.historyBalances = data.balances;
      if (data.rules.length) { state.rules = data.rules; local.set('rules', state.rules); state.rulesDirty = false; }
      else if (state.rules.length) state.rulesDirty = true; // local rules will be uploaded on the next save
      const months = [...new Set(data.transactions.map(t => t.date.slice(0, 7)))].sort();
      setStatus(`Loaded ${data.transactions.length} saved transactions${months.length ? ` (${months[0]} → ${months[months.length - 1]})` : ''}.${data.skipped.length ? ` Skipped unreadable sheet rows: ${data.skipped.slice(0, 5).join(', ')}${data.skipped.length > 5 ? '…' : ''}.` : ''}`);
    } else {
      setStatus('Signed in. No tracker yet — one is created the first time you save.');
    }
    state.month = null;
    state.monthPinned = false;
    rebuild();
    return true;
  } catch (e) {
    console.error(e);
    setStatus((e as Error).message, 'error');
    return false;
  } finally {
    setBusy(false);
  }
}

export async function doSignOut() {
  const u = unsavedCounts();
  if ((u.fresh || u.edited) && !confirm(`You have ${u.fresh + u.edited} unsaved change(s). Sign out anyway?`)) return;
  await signOut();
  Object.assign(state, { email: null, sheetId: null, history: [], historyBalances: [], files: [], month: null, monthPinned: false });
  setStatus('Signed out. Your data and loaded statements were cleared from this tab.');
  rebuild();
}

function sheetLog(msg: string, cls = '', link?: string) {
  state.sheetLog = [...state.sheetLog, { time: new Date().toLocaleTimeString(), msg, cls, link }];
  emit();
}

export async function save() {
  state.sheetLog = [];
  emit();
  if (!currentSession() && !(await doSignIn())) { sheetLog('Sign in first.', 'error'); return; }
  const errs = collectIssues().filter(i => i.level === 'error').length;
  if (errs && !confirm(`${errs} parse error(s) are still in the log. Save anyway?`)) return;
  setBusy(true);
  try {
    if (!state.sheetId) {
      sheetLog('Creating your "Spending tracker" spreadsheet…');
      state.sheetId = await createSpreadsheet();
      local.set(`sheet:${state.email}`, state.sheetId);
    }
    const fresh = state.txns.filter(t => !t.saved);
    const edited = state.txns.filter(t => t.saved && t.dirty);
    const balances = latestBalances();
    const r = await saveAll(state.sheetId, { fresh, edited, rules: state.rules, balances }, m => sheetLog(m));
    for (const t of fresh) if (t.saved) { t.manual = true; state.history.push(t); }
    state.historyBalances = balances;
    state.rulesDirty = false;
    sheetLog(`Done — ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} were already there` : ''}.`, '', sheetUrl(state.sheetId));
    rebuild();
  } catch (e) {
    sheetLog(`ERROR: ${(e as Error).message}`, 'error');
    console.error(e);
  } finally {
    setBusy(false);
  }
}

