// sheets.ts — Google sign-in and the spreadsheet that acts as your private database.
//
// Scopes: openid + email (to show who is signed in) and drive.file — the page can only see files it created
// itself, never the rest of your Drive. Anyone can sign in, but each person only ever reaches their own tracker.
// Tokens live in memory only (never localStorage) and expire after ~1 hour.

import type { Balance, Kind, Rule, Txn } from './types.ts';

// Just the slice of Google Identity Services this file uses.
interface TokenResponse { access_token: string; expires_in: number | string; error?: string; error_description?: string }
interface GoogleOAuth2 {
  initTokenClient(cfg: {
    client_id: string; scope: string; hint?: string;
    callback: (r: TokenResponse) => void;
    error_callback: (e: { type: string; message?: string }) => void;
  }): { requestAccessToken(opts: { prompt: string }): void };
  hasGrantedAllScopes(token: TokenResponse, scope: string): boolean;
  revoke(token: string, done: () => void): void;
}
declare global {
  interface Window { google?: { accounts?: { oauth2?: GoogleOAuth2 } } }
}

interface Session { token: string; exp: number; email: string }
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const TITLE = 'Spending tracker';
export const HEADER = ['ID', 'Date', 'Month', 'Account', 'Merchant', 'Description', 'Amount', 'Category', 'Kind'];
const RULES_HEADER = ['Pattern', 'Field', 'Category', 'Kind'];
const BAL_HEADER = ['Account', 'Closing balance', 'Updated'];
const TABS: Record<string, string[] | null> = { Transactions: HEADER, Rules: RULES_HEADER, Balances: BAL_HEADER, Summary: null };
const SUMMARY_FORMULA = `=QUERY(Transactions!A:I,"select H, sum(G) where I = 'expense' group by H pivot C label H 'Category'",1)`;
const KINDS: Kind[] = ['expense', 'income', 'transfer'];

let session: Session | null = null;

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in (accounts.google.com). Offline, or blocked by an extension?'));
    document.head.appendChild(s);
  });
}

export const currentSession = () => (session && session.exp > Date.now() + 60000 ? session : null);

export async function signIn(clientId: string, { hint }: { hint?: string } = {}): Promise<Session> {
  if (!clientId) throw new Error('No Google OAuth Client ID configured — set it in src/config.ts (see README).');
  if (location.protocol === 'file:') throw new Error('Google sign-in does not work from file://. Serve the folder over http(s).');
  await loadGis();
  const oauth2 = window.google!.accounts!.oauth2!;
  const token = await new Promise<TokenResponse>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      hint,
      callback: r => (r.error ? reject(new Error(`Google sign-in failed: ${r.error_description || r.error}`)) : resolve(r)),
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : e.type === 'popup_failed_to_open' ? 'The browser blocked the sign-in popup — allow popups for this site.' : `Google sign-in error: ${e.message || e.type}`)),
    });
    client.requestAccessToken({ prompt: session ? '' : 'select_account' });
  });
  if (!oauth2.hasGrantedAllScopes(token, 'https://www.googleapis.com/auth/drive.file')) {
    throw new Error('Google sign-in succeeded, but access to the tracker spreadsheet was not granted. Sign in again and tick the Google Drive box.');
  }
  const info = await api<{ email: string }>(token.access_token, 'GET', 'https://www.googleapis.com/oauth2/v3/userinfo');
  session = { token: token.access_token, exp: Date.now() + (Number(token.expires_in) || 3600) * 1000, email: info.email };
  return session;
}

export async function signOut(): Promise<void> {
  const s = session;
  session = null;
  const oauth2 = window.google?.accounts?.oauth2;
  if (s && oauth2) await new Promise<void>(res => oauth2.revoke(s.token, res));
}

async function api<T = any>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
    let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg: string = json.error?.message || text.slice(0, 300);
    let hint = '';
    if (res.status === 401) { session = null; hint = ' — your sign-in expired; sign in again.'; }
    else if (/has not been used|is disabled/i.test(msg)) hint = ' — enable this API in your Google Cloud project (see README), wait a minute, then retry.';
    else if (res.status === 404 || res.status === 403) hint = ' — this page can only open spreadsheets it created itself.';
    throw new ApiError(`${method} ${url.split('?')[0].replace(API, 'sheets').replace(DRIVE, 'drive')} → HTTP ${res.status}: ${msg}${hint}`, res.status);
  }
  return json as T;
}
const call = <T = any>(method: string, url: string, body?: unknown) => {
  const s = currentSession();
  if (!s) throw new Error('Not signed in (or the sign-in expired). Click "Sign in with Google".');
  return api<T>(s.token, method, url, body);
};
const range = (r: string) => encodeURIComponent(r);

// ---------------------------------------------------------------- finding / creating the tracker
export async function findSpreadsheet(): Promise<string | null> {
  // drive.file means this lists only spreadsheets this app created — i.e. your tracker(s).
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name='${TITLE}'`);
  const r = await call<{ files?: { id: string }[] }>('GET', `${DRIVE}?q=${q}&orderBy=modifiedTime desc&pageSize=5&fields=files(id,name,modifiedTime)`);
  return r.files?.[0]?.id || null;
}

export async function createSpreadsheet(): Promise<string> {
  const sheet = await call<{ spreadsheetId: string }>('POST', API, {
    properties: { title: TITLE },
    sheets: Object.keys(TABS).map(title => ({ properties: { title, gridProperties: { frozenRowCount: title === 'Summary' ? 0 : 1 } } })),
  });
  const id = sheet.spreadsheetId;
  await writeHeaders(id, Object.keys(TABS));
  return id;
}

async function writeHeaders(id: string, tabs: string[]) {
  const data = tabs.map(t => (TABS[t] ? { range: `${t}!A1`, values: [TABS[t]] } : { range: 'Summary!A1', values: [[SUMMARY_FORMULA]] }));
  await call('POST', `${API}/${id}/values:batchUpdate`, { valueInputOption: 'USER_ENTERED', data });
}

async function ensureTabs(id: string) {
  const meta = await call<{ sheets?: { properties: { title: string } }[] }>('GET', `${API}/${id}?fields=sheets.properties.title`);
  const titles = (meta.sheets || []).map(s => s.properties.title);
  const add = Object.keys(TABS).filter(t => !titles.includes(t));
  if (add.length) {
    await call('POST', `${API}/${id}:batchUpdate`, { requests: add.map(title => ({ addSheet: { properties: { title } } })) });
    await writeHeaders(id, add);
  }
}

// ---------------------------------------------------------------- reading
type Cell = string | number | boolean;
const EPOCH = Date.UTC(1899, 11, 30);
function toIsoDate(v: Cell | undefined): string | null {
  if (typeof v === 'number') return new Date(EPOCH + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = String(v || '').replace(/^'/, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // d/m/yyyy (Singapore locale)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

interface TrackerData { transactions: Txn[]; skipped: number[]; rules: Rule[]; balances: Balance[] }

export async function loadAll(id: string): Promise<TrackerData> {
  await ensureTabs(id);
  const r = await call<{ valueRanges: { values?: Cell[][] }[] }>('GET', `${API}/${id}/values:batchGet?ranges=${range('Transactions!A2:I')}&ranges=${range('Rules!A2:D')}&ranges=${range('Balances!A2:C')}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  const [tx, rules, bal] = r.valueRanges.map(v => v.values || []);
  const skipped: number[] = [];
  const transactions: Txn[] = [];
  tx.forEach((row, i) => {
    const [txId, date, , account, merchant, description, amount, category, kind] = row;
    const iso = toIsoDate(date);
    const amt = typeof amount === 'number' ? amount : Number(String(amount).replace(/[^\d.-]/g, ''));
    if (!txId || !iso || !Number.isFinite(amt)) { if (row.some(c => c !== '')) skipped.push(i + 2); return; }
    transactions.push({
      id: String(txId), date: iso, account: String(account || ''), merchant: String(merchant || ''), description: String(description || ''),
      amount: Math.round(amt * 100) / 100, category: String(category || 'Uncategorised'),
      kind: KINDS.includes(kind as Kind) ? (kind as Kind) : amt < 0 ? 'expense' : 'income',
      saved: true, manual: true, sheetRow: i + 2,
    });
  });
  return {
    transactions,
    skipped,
    rules: rules.filter(x => x[0] && x[2]).map(([match, field, category, kind]) => ({
      match: String(match), field: field === 'merchant' ? 'merchant' : undefined, category: String(category), kind: (kind as Kind) || 'expense',
    })),
    balances: bal.filter(x => x[0] && Number.isFinite(Number(x[1]))).map(([account, closing, updated]) => ({ account: String(account), closing: Number(closing), updated: String(updated || '') })),
  };
}

// ---------------------------------------------------------------- writing
const safe = <T,>(v: T): T | string => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v); // block formula injection in text cells
function toSheetRow(t: Txn): Cell[] {
  return [t.id, `'${t.date}`, `'${t.date.slice(0, 7)}`, safe(t.account), safe(t.merchant), safe(t.description), t.amount, safe(t.category), t.kind];
}

interface SavePayload { fresh: Txn[]; edited: Txn[]; rules: Rule[]; balances: Balance[] }

/**
 * Save everything in one go: append new transactions, update edited categories on saved rows,
 * and replace the Rules and Balances tabs. Marks the saved transactions in place.
 */
export async function saveAll(id: string, { fresh, edited, rules, balances }: SavePayload, log: (msg: string) => void = () => {}) {
  await ensureTabs(id);
  // Re-check IDs already in the sheet so a double click or a second tab can't create duplicates.
  const existing = await call<{ values?: Cell[][] }>('GET', `${API}/${id}/values/${range('Transactions!A2:A')}`);
  const have = new Set((existing.values || []).map(r => String(r[0])));
  const toAdd = fresh.filter(t => !have.has(t.id));
  let added = 0;
  if (toAdd.length) {
    const r = await call<{ updates?: { updatedRange?: string } }>('POST', `${API}/${id}/values/${range('Transactions!A1:I1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values: toAdd.map(toSheetRow) });
    const start = Number(/!A(\d+)/.exec(r.updates?.updatedRange || '')?.[1]);
    toAdd.forEach((t, i) => { t.saved = true; if (start) t.sheetRow = start + i; });
    added = toAdd.length;
    log(`Added ${added} new transaction(s).`);
  }
  fresh.filter(t => have.has(t.id)).forEach(t => { t.saved = true; });

  const data: { range: string; values: Cell[][] }[] = edited.filter(t => t.sheetRow).map(t => ({ range: `Transactions!H${t.sheetRow}:I${t.sheetRow}`, values: [[safe(t.category), t.kind]] }));
  data.push({ range: 'Rules!A2:D', values: rules.map(r => [safe(r.match), r.field || '', safe(r.category), r.kind]) });
  data.push({ range: 'Balances!A2:C', values: balances.map(b => [safe(b.account), b.closing, b.updated || '']) });
  await call('POST', `${API}/${id}/values:batchClear`, { ranges: ['Rules!A2:D', 'Balances!A2:C'] });
  await call('POST', `${API}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data });
  edited.forEach(t => { t.dirty = false; });
  if (edited.length) log(`Updated categories on ${edited.length} saved row(s).`);
  log(`Saved ${rules.length} rule(s) and ${balances.length} account balance(s).`);
  return { added, updated: edited.length, skipped: fresh.length - toAdd.length };
}
