# Mock statements — fictional test data

All names, account numbers and transactions are made up. Every page has a "MOCK STATEMENT" watermark.
They're generated from one simulated ledger (Jul–Sep 2026), so balances carry over between months and
transfers appear on both sides.

## The 9 normal files: load them all together

| File | Expect |
|---|---|
| `PayLah_2026-07/08/09.pdf` | clean, 1/1 balance check each. Statements run 23rd → 22nd, so July includes a few late-June rows |
| `POSB_Consolidated_2026-07/08/09.pdf` | clean, all checks green. Everyday Savings, SAYE (quarter-to-date) and SRS sections, with page breaks mid-account |
| `SC_JumpStart_2026-07/08/09.pdf` | clean, 1/1 check. 4 pages each, with cashback, FAST in from POSB, card spend incl. USD charges, an ATM withdrawal and interest |

Together: **245 rows → 239 unique**. The 6 repeated SAYE rows should be reported as "counted once".

What to look for:
- **Internal transfers** should be greyed out and excluded from spending: PayLah top-ups (POSB → PayLah), the monthly S$1,500 POSB → SC, SAYE S$300, and the DBS credit card bill.
- **Uncategorised on purpose:** ATM WITHDRAWAL, SHENG HUAT HARDWARE, OLD CHANG KEE (good for testing rules).
- **Insights** should open on 2026-09 with month-over-month observations.

## edge-cases/: one file at a time, each should fail in a specific way

| File | Expected log |
|---|---|
| `SC_2026-09_misprinted-balance.pdf` | 2 errors: running-balance mismatch on one row and the next |
| `PayLah_2026-09_missing-row.pdf` | 1 error: balances don't reconcile (a row is missing) |
| `POSB_2026-09_password-MOCK1234.pdf` | asks for a password. `MOCK1234` parses cleanly; a wrong one re-prompts |
| `Scanned_photo_no-text-layer.pdf` | 1 error: no text layer (scan/photo) |
| `Unknown_bank_statement.pdf` | 1 error: can't tell which bank, shows first lines read |
| `Not_actually_a_PDF.pdf` | 1 error: invalid PDF |

Because the edge-case transactions duplicate September's, loading them alongside the normal files adds no extra rows.

`expected.json` has exact per-file counts, net totals and closing balances. To regenerate or verify:
`python3 test/make_mocks.py && node test/verify_mocks.mjs`
