# Spending Parser

A static site (React + TypeScript, built with Vite) that reads your monthly e-statements (Standard Chartered, POSB/DBS consolidated, DBS PayLah!), categorises every transaction, and pushes clean rows to a Google Sheet. Parsing happens in your browser tab, and the statements are never uploaded anywhere.

## Run it

Needs Node 22.18 or newer.

```bash
npm install
npm run dev
# open http://localhost:8000
```

The dev server listens on 127.0.0.1 only, which keeps it off your LAN. `npm run build` writes the static site to `dist/`, and `npm run preview` serves that build locally. On Vercel, import the repo and it builds as a Vite project with no extra settings.

## Monthly routine

1. Open the site and **Sign in with Google**. Everything you've saved before loads: transactions, your rules, and account balances.
2. Drop in **only the new month's PDFs**. Rows already in your tracker are skipped automatically, and the log says how many.
3. Check the **Parse log**: each file should show green balance checks and "clean".
4. Fix any categories. Rows marked **new** aren't saved yet. Editing an old row marks it **edited**.
5. Click **Save to tracker**. New rows are appended, edited categories are updated in place, and rules and balances are saved.

You can still use the page without signing in: parse, review, see insights, download CSV. Nothing is kept after you close the tab.

## Insights dashboard

Once statements are loaded, the **Insights** card shows the month with the most transactions (switch months with the dropdown):

- **Stat tiles:** spent (vs last month when comparable), came in, left over and savings rate, per-day spend, number of purchases.
- **Observations:** plain-language notes from simple rules: savings rate, biggest category, month-over-month movers, subscriptions (annualised), small frequent purchases, delivery vs eating out, ride-hailing vs public transport, weekend share, largest one-offs, low-interest idle cash (using each account's closing balance), and uncategorised spending. They're computed in the tab, and they're prompts to look closer, not financial advice.
- **Charts:** where it went (by category, with a last-month marker), spending pace (running total by day vs last month), top merchants, day of week, which account paid, and month by month.
- **Show data tables** puts the numbers under each chart.

Month-over-month comparisons only appear when the previous month has a similar number of transactions loaded, because statement periods (PayLah especially) start mid-month and would otherwise make the previous month look artificially cheap.

## How parsing is verified

Every bank statement carries its own checksums, and the parser uses all of them:

| Bank | Check |
|---|---|
| POSB/DBS | Every row: previous balance ± amount must equal the printed running balance. Every "Balance Brought Forward" must match the last page's balance. "Total Balance Carried Forward" withdrawals, deposits, and balance must equal the sum of the parsed rows. |
| Standard Chartered | Every row is checked against the running balance, and the closing balance is checked against the computed one. |
| PayLah! | PREVIOUS BALANCE + all parsed CR/DB rows must equal Total Balance Carried Forward. |

If a row lands in the wrong column but the running balance shows it should be the opposite sign, the parser flips it and logs a **warning**. Anything it can't reconcile is logged as an **error**. Each error includes the page number and the exact extracted line, so you can find it in the PDF.

### When a bank changes its layout

- **Inspect lines** shows every line the parser extracted, with its role: `row`, `cont`, `open`, `close`, `header`, `unparsed`, and so on.
- **Masked debug dump** downloads every extracted line with x-positions and **all digits replaced by 0**. That's safe to share if you want help fixing a parser. It still contains merchant and person names, so skim it first.

## Google sign-in setup (one-time, ~15 min)

Your saved data lives in a spreadsheet called **Spending tracker** in your own Google Drive. Google sign-in is the authentication, and there's no server or database of ours.

1. Go to <https://console.cloud.google.com/> and create a project, e.g. "spending-parser".
2. **APIs & Services → Library**: enable **Google Sheets API** and **Google Drive API**. The Drive API is used only to find your tracker when you sign in on a new device.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, publishing status **Testing**.
   - **Test users**: add your Gmail address. While the app is in Testing, only listed test users can sign in at all, which works as an allowlist on top of everything else.
4. **Credentials → Create credentials → OAuth client ID → Web application**, with **Authorized JavaScript origins**:
   - `https://<your-project>.vercel.app` (your Vercel URL, no trailing slash)
   - `http://localhost:8000` (optional, for running locally)
5. Put the Client ID in **`src/config.ts`** (`export const GOOGLE_CLIENT_ID: string = '…apps.googleusercontent.com';`) and redeploy. The client ID isn't a secret: Google only accepts it from the origins you listed.

### What the page can access

| Scope | Why |
|---|---|
| `openid email` | to show which account is signed in |
| `drive.file` | read and write **only spreadsheets this app created**. It can't see or list anything else in your Drive. |

- **Each account only sees its own data.** Anyone can open the public URL. Even if someone outside the test-user list could sign in, they'd only reach their own tracker, never yours.
- **The access token is held in memory only.** It's never written to localStorage or cookies, and it expires after about an hour. After that, saving asks you to sign in again.
- **Signing out clears your data from the tab.** It revokes the token and clears saved data and loaded statements.

### Tracker layout

| Tab | Contents |
|---|---|
| `Transactions` | ID, Date, Month, Account, Merchant, Description, Amount (negative = money out), Category, Kind |
| `Rules` | your merchant → category rules (shared across devices) |
| `Balances` | latest closing balance per account (used by the idle-cash insight) |
| `Summary` | QUERY pivot of expenses by category × month |

You can edit categories directly in the sheet too. The page reads whatever is there on the next sign-in. Don't edit the ID column.

## What leaves your machine

| When | What | To |
|---|---|---|
| Page load | nothing (pdf.js is bundled into the build) | — |
| Parsing PDFs | nothing; PDFs are never uploaded anywhere | — |
| Sign in | the Google sign-in flow | Google |
| Save to tracker | cleaned rows only (no account numbers, no statement headers), your rules, closing balances | your own Google Sheet |

A Content-Security-Policy, added to the production build by `vite.config.ts`, blocks requests to anywhere except Google's sign-in, Drive, and Sheets endpoints. Description text is sanitised before it reaches the table or sheet: any token with 6+ digits becomes `•••`.

## Categories and kinds

- **kind = expense** counts toward spending. **income** is shown separately. **transfer** is excluded from both, which covers SAYE top-ups, PayLah top-ups, card bill payments, and money moving between your own accounts.
- Internal transfers are detected two ways: by rules, and by pairing an outflow in one account with an equal inflow in another within 3 days.
- Use the category **Reimbursement** (kind expense) for a friend paying you back. The positive amount then offsets your spending.
- Your rules are stored in this browser's localStorage. Use **Export rules.json** to keep a copy, and **Import** it on a new machine.

## Files

```
src/config.ts                     your Google OAuth client ID
src/main.tsx  src/App.tsx         React entry point and page layout
src/store.ts                      app state and actions (loading PDFs, categorising, sign-in, saving)
src/components/                   one component per card, plus Dashboard.tsx (hand-built SVG charts)
src/lib/parsers.ts                PDF → transactions (pure, no DOM/network)
src/lib/categorise.ts             rules, transfer matching, IDs
src/lib/insights.ts               dashboard numbers and observations
src/lib/sheets.ts                 Google sign-in + tracker spreadsheet (load/save)
src/lib/types.ts                  shared types
src/style.css                     all styles
vite.config.ts                    dev server + Content-Security-Policy for builds
test/                             mock/sample statement generators + Node harnesses
```

Run the tests with `npm test`. It parses every PDF in `test/samples` and `test/mocks` with the same `src/lib` code the browser uses (Node runs the TypeScript directly), and compares the results against the expected counts, totals and balances. The PDFs are committed; to regenerate them, run `python3 test/make_samples.py` and `python3 test/make_mocks.py` (needs `reportlab`). `npm run typecheck` checks the types.

## Not yet supported

- **Singlife.** It's detected, but there's no parser yet. Add one by sending a censored sample.
- **Scanned or photographed statements.** The PDF needs a text layer, so use the bank's downloaded e-statement.
- **SC credit-card statements.** This version handles SC deposit accounts like JumpStart, whose table has Deposit / Withdrawal / Balance columns.
