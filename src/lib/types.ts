// types.ts — shapes shared by the parsers, the rules engine, the tracker and the UI.

export type Kind = 'expense' | 'income' | 'transfer';
export type BankId = 'paylah' | 'posb' | 'sc' | 'singlife';
export type IssueLevel = 'error' | 'warn' | 'info';

export interface Chunk { str: string; x: number; xEnd: number; h: number; cx: number }
export interface Line { page: number; y: number; chunks: Chunk[]; text: string; tag: string }
export interface Page { page: number; lines: Line[] }

export interface Issue { level: IssueLevel; msg: string; page?: number; text?: string }
export interface Check { ok: boolean; label: string; detail: string; page?: number }
export interface Balance { account: string; closing: number; updated?: string }

export interface Txn {
  id: string;
  date: string;          // YYYY-MM-DD
  account: string;
  merchant: string;
  description: string;
  amount: number;        // negative = money out
  category: string;
  kind: Kind;
  source?: { page: number; text: string };
  rule?: string | null;
  manual?: boolean;      // category/kind set by you (or loaded from the tracker) — never re-categorised
  matchedWith?: string | null;
  saved?: boolean;       // already in the tracker spreadsheet
  dirty?: boolean;       // saved, then edited
  sheetRow?: number;
  file?: string;
}

export interface ParseResult {
  fileName: string;
  bank: BankId | null;
  transactions: Txn[];
  checks: Check[];
  issues: Issue[];
  pages: Page[];
  balances: Balance[];
}

export interface Rule {
  match: string;
  category: string;
  kind: Kind;
  field?: 'merchant';
  sign?: 'in' | 'out';
  account?: string;
}
