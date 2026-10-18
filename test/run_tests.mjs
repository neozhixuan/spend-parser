// Node harness: parse the synthetic samples with the same parsers.js the browser uses.
// Usage: python3 test/make_samples.py && node test/run_tests.mjs [--verbose]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseStatement } from '../src/lib/parsers.ts';
import { categorise, matchTransfers, DEFAULT_RULES } from '../src/lib/categorise.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'samples');
const verbose = process.argv.includes('--verbose');

const expect = {
  'paylah_sep.pdf': { bank: 'paylah', txns: 8, errors: 0, checksOk: 1 },
  'posb_sep.pdf': { bank: 'posb', txns: 13, errors: 0, checksOk: 8 },
  'sc_sep.pdf': { bank: 'sc', txns: 10, errors: 0, checksOk: 1 },
  'sc_sep_broken.pdf': { bank: 'sc', txns: 10, errors: 1 },
};

let failed = 0;
const all = [];
for (const f of readdirSync(dir).filter(n => n.endsWith('.pdf')).sort()) {
  const data = new Uint8Array(readFileSync(join(dir, f)));
  const pdf = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const res = await parseStatement(pdf, f);
  const errors = res.issues.filter(i => i.level === 'error');
  const ok = res.checks.filter(c => c.ok).length;
  console.log(`\n=== ${f} → ${res.issues[0].msg}`);
  for (const i of res.issues.slice(1)) console.log(`  [${i.level}] p${i.page ?? '-'} ${i.msg}${i.text ? `\n          line: ${i.text}` : ''}`);
  for (const c of res.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}: ${c.detail}`);
  if (verbose) for (const t of res.transactions) console.log(`  ${t.date}  ${t.account.padEnd(24)} ${String(t.amount).padStart(9)}  ${t.merchant}  ‖ ${t.description}`);
  if (verbose) for (const p of res.pages) for (const l of p.lines) console.log(`    p${p.page} y${l.y} [${l.tag}] ${l.text}`);
  const e = expect[f];
  if (e) {
    const probs = [];
    if (res.bank !== e.bank) probs.push(`bank ${res.bank} ≠ ${e.bank}`);
    if (res.transactions.length !== e.txns) probs.push(`txns ${res.transactions.length} ≠ ${e.txns}`);
    if (errors.length !== e.errors) probs.push(`errors ${errors.length} ≠ ${e.errors}`);
    if (e.checksOk != null && ok !== e.checksOk) probs.push(`checks ok ${ok} ≠ ${e.checksOk}`);
    if (probs.length) { failed++; console.log(`  ❌ FAIL: ${probs.join('; ')}`); } else console.log('  ✅ as expected');
  }
  if (f !== 'sc_sep_broken.pdf') all.push(...res.transactions);
}

const cats = categorise(all, [], DEFAULT_RULES);
matchTransfers(cats);
console.log('\n=== categorised');
for (const t of cats) console.log(`  ${t.date} ${t.account.padEnd(24)} ${String(t.amount).padStart(9)}  ${t.category.padEnd(22)} ${t.kind.padEnd(8)} ${t.merchant}`);
process.exit(failed ? 1 : 0);
