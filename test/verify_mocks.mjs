// Parse every mock statement with the real parser and compare against test/mocks/expected.json.
// Usage: python3 test/make_mocks.py && node test/verify_mocks.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseStatement } from '../src/lib/parsers.ts';
import { categorise, matchTransfers, assignIds, DEFAULT_RULES } from '../src/lib/categorise.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'mocks');
const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
const verbose = process.argv.includes('--verbose');
const near = (a, b) => Math.abs(a - b) < 0.005;
let failed = 0;
const clean = [];

for (const [file, e] of Object.entries(exp.files)) {
  let res;
  try {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(dir, file))), password: e.password, verbosity: 0 }).promise;
    res = await parseStatement(pdf, file);
  } catch (err) {
    res = { bank: null, transactions: [], checks: [], balances: [], issues: [{ level: 'error', msg: `pdf.js could not open the file: ${err.message}` }] };
  }
  await assignIds(res.transactions);
  const errors = res.issues.filter(i => i.level === 'error');
  const probs = [];
  if ((res.bank || null) !== (e.bank || null)) probs.push(`bank ${res.bank} ≠ ${e.bank}`);
  if (res.transactions.length !== e.transactions) probs.push(`transactions ${res.transactions.length} ≠ ${e.transactions}`);
  if (errors.length !== e.errors) probs.push(`errors ${errors.length} ≠ ${e.errors}`);
  if (e.net != null) {
    const net = res.transactions.reduce((s, t) => s + t.amount, 0);
    if (!near(net, e.net)) probs.push(`net ${net.toFixed(2)} ≠ ${e.net}`);
  }
  for (const [acct, bal] of Object.entries(e.closing || {})) {
    const got = (res.balances || []).find(b => b.account === acct)?.closing;
    if (got == null || !near(got, bal)) probs.push(`closing ${acct} ${got} ≠ ${bal}`);
  }
  const failedChecks = res.checks.filter(c => !c.ok).length;
  const flagged = res.transactions.filter(t => /Reg\. No|Registration|Page \d/i.test(t.description));
  if (flagged.length) probs.push(`${flagged.length} descriptions contain footer text`);
  console.log(`${probs.length ? '❌' : '✅'} ${file.padEnd(48)} ${String(res.transactions.length).padStart(3)} txns · ${res.checks.filter(c => c.ok).length}/${res.checks.length} checks · ${errors.length} errors${probs.length ? '  → ' + probs.join('; ') : ''}`);
  if (e.errors || verbose) for (const i of errors) console.log(`      [error] ${i.msg.slice(0, 150)}`);
  if (probs.length) failed++;
  if (!file.startsWith('edge-cases/')) clean.push(...res.transactions);
  if (failedChecks && !e.errors) console.log(`      ${failedChecks} failed checks`);
}

// combined: de-duplication across files, categorisation, transfer matching
const seen = new Set();
const unique = clean.filter(t => (seen.has(t.id) ? false : seen.add(t.id)));
const c = exp.combined;
const dupes = clean.length - unique.length;
console.log(`\nCombined: ${clean.length} rows in files, ${dupes} duplicates, ${unique.length} unique (expected ${c.rows_in_files}/${c.duplicates}/${c.unique})`);
if (clean.length !== c.rows_in_files || dupes !== c.duplicates || unique.length !== c.unique) { failed++; console.log('❌ combined counts differ'); }
categorise(unique, [], DEFAULT_RULES);
const pairs = matchTransfers(unique);
const byCat = {};
for (const t of unique) byCat[t.category] = (byCat[t.category] || 0) + 1;
const uncat = unique.filter(t => t.category === 'Uncategorised');
console.log(`Transfer pairs matched: ${pairs} · categories: ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Uncategorised merchants: ${[...new Set(uncat.map(t => t.merchant))].join(', ') || 'none'}`);
const posbToSc = unique.filter(t => t.matchedWith && /STANDARD CHARTERED|FROM POSB/i.test(`${t.merchant} ${t.description}`)).length;
const topups = unique.filter(t => /TOP.?UP/i.test(t.description) && t.kind === 'transfer').length;
console.log(`POSB→SC transfer legs matched: ${posbToSc} (expect ${c.posb_to_sc_transfers * 2}) · top-up legs marked transfer: ${topups} (expect ${c.paylah_topups * 2})`);
if (posbToSc !== c.posb_to_sc_transfers * 2 || topups !== c.paylah_topups * 2) { failed++; console.log('❌ transfer handling differs'); }
console.log(failed ? `\n${failed} problem(s)` : '\nAll mock statements parsed exactly as expected.');
process.exit(failed ? 1 : 0);
