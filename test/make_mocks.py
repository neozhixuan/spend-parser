"""Generate realistic MOCK statements for testing the Spending Parser.

Three months (Jul-Sep 2026) for each of DBS PayLah!, POSB/DBS consolidated and Standard Chartered,
generated from ONE simulated ledger so that:
  * balances carry over from statement to statement,
  * PayLah top-ups appear in both POSB (out) and PayLah (in),
  * the monthly POSB -> SC transfer appears on both sides,
  * the POSB SAYE section is quarter-to-date (Jul, Jul-Aug, Jul-Sep) like the real statement,
    so loading all three months exercises de-duplication.
Plus edge-case files that should produce specific errors.

Every page carries a diagonal "MOCK STATEMENT" watermark (rotated text is ignored by the parser).
All names, numbers and accounts are fictional.

Usage:  python3 test/make_mocks.py            -> writes test/mocks/ and test/mocks/expected.json
"""
import calendar
import datetime as dt
import io
import json
import os
import random
import string

from reportlab.lib.colors import Color, HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

W, H = A4
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "mocks")
EDGE = os.path.join(OUT, "edge-cases")
R = random.Random(2026)
D = dt.date
MONTHS = [(2026, 7), (2026, 8), (2026, 9)]
MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NAME = "TAN AH KOW"
ADDR = ["BLK 123 EXAMPLE STREET 45", "#01-234", "SINGAPORE 000123"]


def money(v):
    return f"{v:,.2f}"


def r2(v):
    return round(v + 1e-9, 2)


def last_day(y, m):
    return calendar.monthrange(y, m)[1]


def ref(n=12, alpha=False):
    pool = string.ascii_uppercase + string.digits if alpha else string.digits
    return "".join(R.choice(pool) for _ in range(n))


# =====================================================================================
# 1. Simulated ledger
# =====================================================================================
posb, saye, sc, paylah = [], [], [], []   # each item: dict(date, amount, lines)


def add(lst, date, amount, lines, **kw):
    lst.append(dict(date=date, amount=r2(amount), lines=lines, **kw))


# ---- PayLah (continuous Jun 23 -> Sep 22), with POSB top-ups when the wallet runs low
PAYLAH_SPEND = [
    ("SHOPEEPAY SG", 3, 26, 5), ("KOPITIAM BEDOK MALL", 2.2, 6.8, 5), ("MR BEAN TAMPINES", 1.8, 4.6, 2),
    ("OLD CHANG KEE TAMPINES", 1.9, 6.4, 2), ("HAWKER QR - 85 FENGSHAN FOOD", 3.5, 8.0, 4),
    ("GOLDEN VILLAGE TAMPINES", 13.5, 27.0, 1), ("LIHO TEA TAMPINES", 3.9, 5.6, 2), ("SEND MONEY TO LIM JIA HUI", 10, 42, 1),
]
pl_open = 85.40
bal = pl_open
day = D(2026, 6, 23)
while day <= D(2026, 9, 22):
    for _ in range(R.choices([0, 1, 2], [0.62, 0.3, 0.08])[0]):
        name, lo, hi, _w = R.choices(PAYLAH_SPEND, [x[3] for x in PAYLAH_SPEND])[0]
        amt = r2(R.uniform(lo, hi))
        if bal - amt < 8 and day >= D(2026, 7, 1):
            top = 100.0 if bal < 30 else 50.0
            bal = r2(bal + top)
            add(paylah, day, top, ["TOP UP FROM DBS/POSB ACCOUNT"], refno="TF" + ref(14))
            add(posb, day, -top, ["Funds Transfer", f"TOP-UP TO PAYLAH! : 8888880000{ref(6)}"])
        if bal - amt < 0:
            continue
        bal = r2(bal - amt)
        add(paylah, day, -amt, [name], refno="MT" + ref(18))
    if R.random() < 0.06:
        amt = r2(R.uniform(8, 35))
        bal = r2(bal + amt)
        add(paylah, day, amt, ["RECEIVE MONEY FROM 90000000"], refno="TF" + ref(14))
    day += dt.timedelta(days=1)

# ---- POSB Everyday Savings (monthly recurring items)
for (y, m) in MONTHS:
    add(posb, D(y, m, 2), -1500.00, ["FAST Payment / Receipt", f"OUTGOING FAST REF {ref(8)}", "TO: STANDARD CHARTERED", "OTHER"], tag="to_sc")
    add(posb, D(y, m, 12), -300.00, ["Monthly Savings Amount for MySavings/POSB", "SAYE Account", "TO MSA: 592000000"])
    add(posb, D(y, m, 15), -r2(R.uniform(520, 880)), ["Bill Payment", "DBS CARD CENTRE", "CREDIT CARD PAYMENT"])
    add(posb, D(y, m, 28), 5800.00, ["Salary", "ACME TECH PTE LTD", "SAL", f"{y % 100}{m:02d}"])
    add(posb, D(y, m, R.randint(18, 26)), -r2(R.uniform(15, 60)), ["FAST Payment / Receipt", "PAYNOW TRANSFER", "TO: LIM JIA HUI", "OTHER"])
    for _ in range(R.randint(1, 2)):
        add(posb, D(y, m, R.randint(3, 27)), r2(R.uniform(12, 45)), ["FAST Payment / Receipt", f"INCOMING PAYNOW REF {ref(7)}", "FROM: ONG KAI WEN", "OTHER"])
    for _ in range(R.randint(2, 3)):
        add(posb, D(y, m, R.randint(1, 27)), -r2(R.uniform(4, 12)), ["Point-of-Sale Transaction", f"NETS QR PAYMENT {ref(16)}", "TO: KIM SENG FOOD"])
add(posb, D(2026, 8, 7), 250.00, ["Payments / Collections via GIRO", "GOV", "GOV", "OTHER"])
add(posb, D(2026, 9, 7), 500.00, ["Payments / Collections via GIRO", "GOV", "GOV", "OTHER"])

# ---- POSB SAYE
for (y, m) in MONTHS:
    add(saye, D(y, m, 12), 300.00, ["Monthly Savings Amount for MySavings/POSB", "SAYE Account", "FROM: 249000000"])

# ---- Standard Chartered JumpStart (debit card spending, posted 0-2 days after the purchase)
SC_POOL = [
    ("TRANSIT {r}", 6, 24, 3, "n14"), ("GRAB* A-{a}", 8.5, 28, 4, "a10"), ("GRAB* FOOD {a}", 12, 36, 2, "a8"),
    ("FOODPANDA SINGAPORE", 14, 32, 1, None), ("NTUC FAIRPRICE TAMPINES", 9, 68, 3, None), ("DON DON DONKI JEWEL", 6, 42, 1, None),
    ("KOPITIAM BEDOK MALL", 3.5, 8.5, 3, None), ("TOAST BOX TAMPINES 1", 4.2, 9.6, 2, None), ("STARBUCKS JEWEL", 6.6, 9.8, 1, None),
    ("SHOPEE SINGAPORE MP {r}", 7, 62, 3, "n12"), ("LAZADA SINGAPORE", 9, 85, 1, None), ("UNIQLO JEM", 29.9, 79.9, 0.4, None),
    ("DECATHLON SINGAPORE", 12, 65, 0.4, None), ("GUARDIAN HEALTH TAMPINES", 4.5, 26, 0.8, None),
    ("GOLDEN VILLAGE TAMPINES", 13.5, 27, 0.5, None), ("SHENG HUAT HARDWARE", 4, 38, 0.3, None), ("BEDOK FOOD CENTRE", 4, 14, 2, None),
]
FIXED = [  # (day, merchant, amount_sgd, fx)
    (1, "ANYTIME FITNESS TAMPINES", 89.00, None), (5, "NETFLIX.COM", 21.07, ("USD", 15.49)),
    (9, "OPENAI *CHATGPT SUBSCR", 27.20, ("USD", 20.00)), (18, "SPOTIFY P{a}", 11.98, None),
    (21, "SP DIGITAL PTE LTD", None, None), (25, "SINGTEL MOBILE BILL", 32.10, None),
]


def fill(tpl, kind):
    if kind and kind.startswith("n"):
        return tpl.format(r=ref(int(kind[1:])))
    if kind and kind.startswith("a"):
        return tpl.format(a=ref(int(kind[1:]), alpha=True))
    return tpl.format(a=ref(8, alpha=True)) if "{a}" in tpl else tpl


purchases = []  # (purchase_date, merchant, sgd, fx)
day = D(2026, 6, 29)
while day <= D(2026, 9, 30):
    weekend = day.weekday() >= 5
    for _ in range(R.choices([0, 1, 2, 3], [0.22, 0.42, 0.26, 0.10] if not weekend else [0.12, 0.33, 0.35, 0.20])[0]):
        tpl, lo, hi, _w, kind = R.choices(SC_POOL, [x[3] for x in SC_POOL])[0]
        purchases.append((day, fill(tpl, kind), r2(R.uniform(lo, hi)), None))
    for (d0, mer, amt, fx) in FIXED:
        if day.day == d0 and day >= D(2026, 7, 1):
            purchases.append((day, fill(mer, "a8") if "{a}" in mer else mer, amt if amt else r2(R.uniform(78, 126)), fx))
    day += dt.timedelta(days=1)
purchases.append((D(2026, 8, 14), "AGODA.COM BOOKING", 412.60, None))
purchases.append((D(2026, 7, 19), "ATM WITHDRAWAL SCB TAMPINES", 100.00, "ATM"))
for (pdate, mer, amt, fx) in purchases:
    post = pdate + dt.timedelta(days=R.choice([0, 1, 1, 2]))
    if not (D(2026, 7, 1) <= post <= D(2026, 9, 30)):
        continue
    if fx == "ATM":
        add(sc, post, -amt, ["ATM WITHDRAWAL", "SCB ATM TAMPINES MRT"], card_spend=False)
        continue
    lines = [f"{pdate.month:02d}/{pdate.day:02d}", mer, f"{fx[0]} {fx[1]:.2f}" if fx else f"SGD {amt:.2f}", f"VALUE DATE AS OF {pdate.day:02d} {MON[pdate.month].upper()}"]
    add(sc, post, -amt, lines, card_spend=True)
for (y, m) in MONTHS:
    add(sc, D(y, m, 2), 1500.00, ["FAST PAYMENT", "FROM POSB 249000000", "OTHER"], tag="from_posb")

# ---- interest, cashback, balances (computed per month in date order)
def sort_key(t):
    return (t["date"], 0 if t["amount"] > 0 else 1)


def run_month(lst, opening, y, m, interest_rate, label):
    rows = sorted([t for t in lst if (t["date"].year, t["date"].month) == (y, m)], key=sort_key)
    bal = opening
    for t in rows:
        bal = r2(bal + t["amount"])
    if interest_rate:
        intr = r2(max(0.01, bal * interest_rate / 12))
        t = dict(date=D(y, m, last_day(y, m)), amount=intr, lines=[label])
        lst.append(t)
        rows.append(t)
        bal = r2(bal + intr)
    return rows, bal


cashback_prev = (945.32, 9.45, 4659.60)  # June figures for the July statement
statements = {"posb": [], "saye": [], "sc": [], "paylah": []}
posb_bal, saye_bal, sc_bal = 14206.18, 4335.17, 3812.40
saye_q_open = saye_bal
for (y, m) in MONTHS:
    # SC cashback on the 1st for last month's card spend
    spend_prev, cb, adb = cashback_prev
    add(sc, D(y, m, 1), cb, ["CASHBACK", f"VALUE DATE AS OF {last_day(y, m - 1):02d} {MON[m - 1].upper()}"])
    rows, close = run_month(posb, posb_bal, y, m, 0.0005, "Interest Earned")
    statements["posb"].append(dict(y=y, m=m, open=posb_bal, rows=rows, close=close))
    posb_bal = close
    rows, close = run_month(saye, saye_bal, y, m, 0.002, "Interest Earned")
    statements["saye"].append(dict(y=y, m=m, open=saye_bal, rows=rows, close=close))
    saye_bal = close
    rows, close = run_month(sc, sc_bal, y, m, 0.001, "INTEREST CREDIT")
    # average daily balance + card spend for next month's cashback table
    daily, b, i = [], sc_bal, 0
    for d in range(1, last_day(y, m) + 1):
        while i < len(rows) and rows[i]["date"].day == d:
            b = r2(b + rows[i]["amount"]); i += 1
        daily.append(b)
    spend = r2(-sum(t["amount"] for t in rows if t.get("card_spend")))
    statements["sc"].append(dict(y=y, m=m, open=sc_bal, rows=rows, close=close, cashback_prev=cashback_prev))
    cashback_prev = (spend, r2(min(20.0, spend * 0.01)), r2(sum(daily) / len(daily)))
    sc_bal = close

pl_bal = pl_open
for (y, m) in MONTHS:
    start = D(y, m - 1, 23)
    end = D(y, m, 22)
    rows = sorted([t for t in paylah if start <= t["date"] <= end], key=lambda t: t["date"])
    close = r2(pl_bal + sum(t["amount"] for t in rows))
    statements["paylah"].append(dict(y=y, m=m, open=pl_bal, rows=rows, close=close))
    pl_bal = close


# =====================================================================================
# 2. Rendering helpers
# =====================================================================================
GREY = HexColor("#9a9a9a")


def T(c, x, y, s, size=8, font="Helvetica", align="l", color=None):
    c.setFont(font, size)
    if color is not None:
        c.setFillColor(color)
    fn = {"l": c.drawString, "r": c.drawRightString, "c": c.drawCentredString}[align]
    fn(x, H - y, s)
    if color is not None:
        c.setFillColorRGB(0, 0, 0)


def watermark(c):
    c.saveState()
    c.setFillColor(Color(0.75, 0.1, 0.1, alpha=0.13))
    c.setFont("Helvetica-Bold", 46)
    c.translate(W / 2, H / 2)
    c.rotate(38)
    c.drawCentredString(0, 18, "MOCK STATEMENT")
    c.setFont("Helvetica-Bold", 20)
    c.drawCentredString(0, -14, "FICTIONAL TEST DATA - NOT A REAL DOCUMENT")
    c.restoreState()


def vertical(c, x, y, s, size=4.5):
    c.saveState(); c.translate(x, H - y); c.rotate(90); c.setFont("Helvetica", size); c.setFillColor(GREY)
    c.drawString(0, 0, s); c.restoreState()


class Doc:
    """Collects draw calls per page so footers can say 'Page n of N'."""

    def __init__(self):
        self.pages = [[]]

    def __call__(self, fn):
        self.pages[-1].append(fn)

    def new_page(self):
        self.pages.append([])

    def save(self, path, footer):
        c = canvas.Canvas(path, pagesize=A4)
        c.setTitle("Mock statement - fictional test data")
        n = len(self.pages)
        for i, ops in enumerate(self.pages, 1):
            watermark(c)
            for op in ops:
                op(c)
            footer(c, i, n)
            c.showPage()
        c.save()


# =====================================================================================
# 3. DBS PayLah!
# =====================================================================================
def render_paylah(st, path, drop_row=None):
    y0, m0 = st["y"], st["m"]
    doc = Doc()
    sdate = f"22 {MON[m0]} {y0}"

    def head(c):
        T(c, 50, 60, "PayLah!", 17, "Helvetica-Bold")
        T(c, 50, 78, "Statement of Account", 9)
        T(c, 545, 58, "DBS Bank Ltd", 6, align="r")
        T(c, 545, 65, "Orchard Road P.O.Box 360 S(000000)", 5, align="r")
        T(c, 50, 120, NAME, 7)
        T(c, 50, 129, "TANAHKOW@EXAMPLE.COM", 7)
        c.setFillColorRGB(0, 0, 0); c.rect(48, H - 176, 500, 13, fill=1, stroke=0)
        c.rect(48, H - 191, 500, 15, fill=0, stroke=1)
        for x, s in [(130, "STATEMENT DATE"), (300, "MOBILE NUMBER"), (465, "WALLET ACCOUNT")]:
            T(c, x, 172, s, 7, align="c", color=white)
        T(c, 130, 187, sdate, 7, "Helvetica-Bold", "c")
        T(c, 300, 187, "90000000", 7, "Helvetica-Bold", "c")
        T(c, 465, 187, "8888880000000000", 7, "Helvetica-Bold", "c")
        T(c, 50, 208, "This statement serves as a TAX INVOICE if GST is charged.", 5)
        c.setFillColor(HexColor("#a6a6a6")); c.roundRect(48, H - 232, 500, 14, 4, fill=1, stroke=0)
        T(c, 540, 228, f"Total: {money(st['close'])} CR", 7, "Helvetica-Bold", "r", white)
        T(c, 55, 246, "Account", 7, "Helvetica-Bold"); T(c, 200, 246, "Account No.", 7, "Helvetica-Bold"); T(c, 540, 246, "Balance", 7, "Helvetica-Bold", "r")
        T(c, 55, 260, "PayLah! Wallet", 7); T(c, 200, 260, "8888880000000000", 7); T(c, 540, 260, f"{money(st['close'])} CR", 7, align="r")

    def table_head(c, y):
        c.setFillColorRGB(0, 0, 0); c.roundRect(48, H - y - 5, 500, 15, 4, fill=1, stroke=0)
        T(c, 58, y, "DATE", 7, "Helvetica-Bold", color=white); T(c, 112, y, "DESCRIPTION", 7, "Helvetica-Bold", color=white)
        T(c, 540, y, "AMOUNT", 7, "Helvetica-Bold", "r", white)

    doc(head)
    doc(lambda c: table_head(c, 282))
    doc(lambda c: (c.roundRect(52, H - 309, 120, 13, 3, fill=0, stroke=1), T(c, 58, 305, "PayLah! Wallet", 6, "Helvetica-Bold")))
    doc(lambda c: (T(c, 58, 324, "PREVIOUS BALANCE", 7), T(c, 535, 324, f"{money(st['open'])} CR", 7, align="r")))
    y = 346
    for i, t in enumerate(st["rows"]):
        if i == drop_row:
            continue
        if y > 770:
            doc.new_page(); doc(lambda c: table_head(c, 60)); y = 84
        d, desc, amt, rf = f"{t['date'].day:02d} {MON[t['date'].month]}", t["lines"][0], t["amount"], t.get("refno", "")
        doc(lambda c, y=y, d=d, desc=desc, amt=amt, rf=rf: (
            T(c, 58, y, d, 7), T(c, 112, y, desc, 7, "Helvetica-Bold"),
            T(c, 535, y, f"{abs(amt):.2f} {'CR' if amt > 0 else 'DB'}", 7, align="r"),
            T(c, 117, y + 8, f"REF NO.: {rf}", 5)))
        y += 25
    if y > 730:
        doc.new_page(); y = 70
    doc(lambda c, y=y: (c.line(48, H - y, 548, H - y), T(c, 400, y + 14, "Total Balance Carried Forward:", 7, "Helvetica-Bold", "r"),
                        T(c, 535, y + 14, f"{money(st['close'])} CR", 7, align="r"), c.line(48, H - y - 24, 548, H - y - 24)))
    y += 50
    if y > 700:
        doc.new_page(); y = 70
    doc(lambda c, y=y: (c.setFillColor(HexColor("#e6e6e6")), c.rect(48, H - y - 5, 500, 15, fill=1, stroke=0), c.setFillColorRGB(0, 0, 0),
                        T(c, 55, y, "USEFUL INFORMATION ON YOUR DBS PAYLAH! WALLET", 7, "Helvetica-Bold"),
                        T(c, 55, y + 25, "Important Notice", 7, "Helvetica-Bold"),
                        T(c, 200, y + 25, "Please examine your transaction records.", 6.5),
                        T(c, 200, y + 37, "Notify us of any error or discrepancy within fourteen (14) days.", 6.5)))

    def footer(c, i, n):
        vertical(c, 565, 520, "Co. Reg. No 000000000E")
        T(c, 300, 820, f"Page {i} of {n}", 6, align="c", color=GREY)

    doc.save(path, footer)


# =====================================================================================
# 4. POSB / DBS consolidated
# =====================================================================================
def render_posb(st, saye_list, path, srs=1.00):
    y0, m0 = st["y"], st["m"]
    ld = last_day(y0, m0)
    asat = f"{ld} {MON[m0]} {y0}"
    doc = Doc()
    # page 1: account summary
    saye_close = saye_list[-1]["close"]

    def summary(c):
        T(c, 555, 58, "DBS  |  POSB", 11, "Helvetica-Bold", "r", HexColor("#c8102e"))
        T(c, 555, 92, "Consolidated Statement", 10, "Helvetica-Bold", "r")
        T(c, 50, 92, NAME, 7)
        for k, s in enumerate(ADDR):
            T(c, 50, 101 + 9 * k, s, 7)
        T(c, 40, 205, "Account Summary", 15, "Helvetica-Bold"); T(c, 172, 205, f"as at {asat}", 7)
        c.setFillColor(HexColor("#3a3a3a")); c.roundRect(40, H - 233, 70, 15, 7, fill=1, stroke=0)
        T(c, 75, 229, "Deposits", 8, "Helvetica-Bold", "c", white)
        c.setFillColor(HexColor("#a6a6a6")); c.rect(40, H - 251, 515, 11, fill=1, stroke=0)
        T(c, 45, 248, "Current and Savings Account", 6.5, "Helvetica-Bold", color=white)
        T(c, 550, 248, f"Total: SGD Equivalent {money(st['close'] + saye_close)}", 6.5, "Helvetica-Bold", "r", white)
        T(c, 45, 280, "Account", 7, "Helvetica-Bold"); T(c, 230, 280, "Account No.", 7, "Helvetica-Bold"); T(c, 520, 280, "Balance (SGD)", 7, "Helvetica-Bold", "r")
        T(c, 45, 295, "POSB Everyday Savings Account", 7); T(c, 230, 295, "000-00000-1", 7); T(c, 520, 295, money(st["close"]), 7, align="r")
        T(c, 45, 308, "POSB SAYE Account", 7); T(c, 230, 308, "000-00000-2", 7); T(c, 520, 308, money(saye_close), 7, align="r")
        T(c, 45, 345, "SRS Account", 7); T(c, 230, 345, "000-000000-0", 7); T(c, 520, 345, money(srs), 7, align="r")
    doc(summary)

    def section(c, y, name):
        c.setFillColor(HexColor("#a6a6a6")); c.roundRect(40, H - y - 4, 515, 12, 6, fill=1, stroke=0)
        T(c, 48, y, name, 7, "Helvetica-Bold", color=white); T(c, 550, y, "Account No. 000-00000-0", 7, "Helvetica-Bold", "r", white)

    def colhead(c, y):
        T(c, 45, y, "Date", 7, "Helvetica-Bold"); T(c, 110, y, "Description", 7, "Helvetica-Bold")
        T(c, 380, y, "Withdrawal (-)", 7, "Helvetica-Bold", "c"); T(c, 460, y, "Deposit (+)", 7, "Helvetica-Bold", "c")
        T(c, 530, y, "Balance (SGD)", 7, "Helvetica-Bold", "c"); c.line(40, H - y - 5, 555, H - y - 5)

    BOTTOM = 770
    state = {"y": 0}

    def new_page(title=False):
        doc.new_page()
        if title:
            doc(lambda c: (T(c, 40, 80, "Transaction Details", 15, "Helvetica-Bold"), T(c, 192, 80, f"as at {asat}", 7)))
            state["y"] = 110
        else:
            state["y"] = 70

    def account(name, opening, rows, closing):
        y = state["y"]
        if y > BOTTOM - 60:
            new_page(); y = state["y"]
        doc(lambda c, y=y: (section(c, y, name), colhead(c, y + 16)))
        y += 34
        doc(lambda c, y=y, b=opening: (T(c, 110, y, "Balance Brought Forward", 7, "Helvetica-Bold"), T(c, 550, y, money(b), 7, "Helvetica-Bold", "r")))
        y += 16
        bal, sw, sd = opening, 0.0, 0.0
        for k, t in enumerate(rows):
            hgt = 9 * len(t["lines"]) + 7
            if y + hgt > BOTTOM:
                doc(lambda c, y=y, b=bal: (T(c, 110, y + 4, "Balance Carried Forward", 7, "Helvetica-Bold"), T(c, 550, y + 4, money(b), 7, "Helvetica-Bold", "r")))
                new_page(); y = state["y"]
                doc(lambda c, y=y: (section(c, y, name), colhead(c, y + 16)))
                y += 34
                doc(lambda c, y=y, b=bal: (T(c, 110, y, "Balance Brought Forward", 7, "Helvetica-Bold"), T(c, 550, y, money(b), 7, "Helvetica-Bold", "r")))
                y += 16
            bal = r2(bal + t["amount"])
            if t["amount"] < 0:
                sw = r2(sw - t["amount"])
            else:
                sd = r2(sd + t["amount"])
            shade = k % 2 == 1

            def draw(c, y=y, t=t, b=bal, hgt=hgt, shade=shade):
                if shade:
                    c.setFillColor(HexColor("#f1f1f1")); c.rect(40, H - y - hgt + 9, 515, hgt, fill=1, stroke=0); c.setFillColorRGB(0, 0, 0)
                T(c, 45, y, t["date"].strftime("%d/%m/%Y"), 7)
                for j, s in enumerate(t["lines"]):
                    T(c, 110, y + 9 * j, s, 7)
                T(c, 405 if t["amount"] < 0 else 485, y, money(abs(t["amount"])), 7, align="r")
                T(c, 550, y, money(b), 7, align="r")
            doc(draw)
            y += hgt
        assert abs(bal - closing) < 0.005, (name, bal, closing)
        doc(lambda c, y=y, sw=sw, sd=sd, b=bal: (c.line(105, H - y + 8, 555, H - y + 8), T(c, 110, y + 2, "Total Balance Carried Forward:", 7, "Helvetica-Bold"),
                                               T(c, 405, y + 2, money(sw), 7, "Helvetica-Bold", "r"), T(c, 485, y + 2, money(sd), 7, "Helvetica-Bold", "r"),
                                               T(c, 550, y + 2, money(b), 7, "Helvetica-Bold", "r"), c.line(105, H - y - 6, 555, H - y - 6)))
        state["y"] = y + 26

    new_page(title=True)
    doc(lambda c: (c.setFillColor(HexColor("#3a3a3a")), c.roundRect(40, H - 102, 70, 15, 7, fill=1, stroke=0), T(c, 75, 98, "Deposits", 8, "Helvetica-Bold", "c", white)))
    account("POSB Everyday Savings Account", st["open"], st["rows"], st["close"])
    saye_rows = [t for s in saye_list for t in s["rows"]]  # quarter-to-date
    account("POSB SAYE Account", saye_list[0]["open"], saye_rows, saye_list[-1]["close"])
    y = state["y"]
    if y > BOTTOM - 80:
        new_page(); y = state["y"]
    doc(lambda c, y=y: (c.setFillColor(HexColor("#3a3a3a")), c.roundRect(40, H - y - 5, 160, 15, 7, fill=1, stroke=0),
                        T(c, 120, y, "Supplementary Retirement Scheme", 8, "Helvetica-Bold", "c", white)))
    state["y"] = y + 24
    account("Supplementary Retirement Scheme Account", srs, [], srs)
    new_page()
    doc(lambda c: (T(c, 50, 90, "Messages For You", 12, "Helvetica-Bold"),
                   T(c, 50, 112, "Best execution policy for handling of customers' orders is available on our website.", 7),
                   T(c, 50, 124, "Protect yourself from scams: never share your OTP or Digital Token with anyone.", 7)))

    def footer(c, i, n):
        T(c, 40, 800, f"{'Account Summary' if i == 1 else 'Transaction Details'} as of {asat}", 7, "Helvetica-Bold")
        T(c, 555, 800, f"Page {i} of {n}", 7, "Helvetica-Bold", "r")
        T(c, 300, 812, "PDS_MOCK_SPEC_ONSH_0000000000000000_00000", 5, align="c", color=GREY)
        vertical(c, 22, 760, "MOCK0000000 DBS Co. Reg. No. 000000000E GST Reg No: MR-0000000-0")

    doc.save(path, footer)


# =====================================================================================
# 5. Standard Chartered
# =====================================================================================
SCX = dict(date=36, desc=92, dep_c=287, wd_c=398, bal_c=510, dep_r=335, wd_r=445, bal_r=560)
GREEN = HexColor("#6ad04f")


def render_sc(st, path, misprint_row=None):
    y0, m0 = st["y"], st["m"]
    ld = last_day(y0, m0)
    pm = m0 - 1
    doc = Doc()
    spend_prev, cb_prev, adb_prev = st["cashback_prev"]

    def colhead(c, y):
        c.setFillColor(HexColor("#2f6db5")); c.rect(28, H - y - 4, 534, 13, fill=1, stroke=0)
        for x, s in [(SCX["date"] + 14, "Date"), (180, "Description"), (SCX["dep_c"], "Deposit"), (SCX["wd_c"], "Withdrawal"), (SCX["bal_c"], "Balance")]:
            T(c, x, y, s, 7, "Helvetica-Bold", "c", white)

    def page1(c):
        c.setFillColor(GREEN); c.roundRect(28, H - 58, 360, 24, 6, fill=1, stroke=0)
        T(c, 208, 50, "Statement of Account", 12, "Helvetica-Bold", "c", HexColor("#1b5aa6"))
        T(c, 555, 46, "standard", 11, align="r", color=HexColor("#1b5aa6")); T(c, 555, 58, "chartered", 11, align="r", color=HexColor("#1b5aa6"))
        T(c, 50, 110, NAME, 7)
        for k, s in enumerate(ADDR):
            T(c, 50, 119 + 9 * k, s, 7)
        T(c, 345, 110, "Statement Date", 7); T(c, 420, 110, f": {ld} {MON[m0]} {y0}", 7)
        T(c, 345, 119, "Branch", 7); T(c, 420, 119, ": MOCK BRANCH", 7)
        c.setFillColor(GREEN); c.rect(28, H - 262, 534, 13, fill=1, stroke=0)
        T(c, 34, 258, "JUMPSTART", 8, "Helvetica-Bold", color=white); T(c, 556, 258, "0000-0-000000 (SGD)", 7, "Helvetica-Bold", "r", white)
        T(c, 295, 276, f"Cashback Summary Table for the month of {calendar.month_name[pm]} {y0}", 7, "Helvetica-Bold", "c")
        T(c, 32, 289, "Mastercard Spend", 7); T(c, 205, 289, money(spend_prev), 7, align="r")
        T(c, 215, 289, "Cashback", 7); T(c, 330, 289, money(cb_prev), 7, align="r")
        T(c, 340, 289, "Average Daily Balance", 7); T(c, 556, 289, money(adb_prev), 7, align="r")
        colhead(c, 306)
        prev_ld = last_day(y0, pm)
        T(c, SCX["date"], 323, f"{prev_ld} {MON[pm]} {y0}", 7, "Helvetica-Bold")
        T(c, SCX["desc"], 323, "BALANCE FROM PREVIOUS STATEMENT", 7, "Helvetica-Bold")
        T(c, SCX["bal_r"], 323, money(st["open"]), 7, "Helvetica-Bold", "r")
    doc(page1)

    y, bal, BOTTOM = 342, st["open"], 772
    for k, t in enumerate(st["rows"]):
        hgt = 8 * len(t["lines"]) + 10
        if y + hgt > BOTTOM:
            doc.new_page()
            doc(lambda c: colhead(c, 60))
            y = 78
        bal = r2(bal + t["amount"])
        shown = r2(bal - 1.00) if k == misprint_row else bal

        def draw(c, y=y, t=t, shown=shown, hgt=hgt, k=k):
            if k % 2 == 0:
                c.setFillColor(HexColor("#dbe9fa")); c.rect(28, H - y - hgt + 9, 534, hgt, fill=1, stroke=0); c.setFillColorRGB(0, 0, 0)
            T(c, SCX["date"], y, f"{t['date'].day:02d} {MON[t['date'].month]} {t['date'].year}", 7)
            for j, s in enumerate(t["lines"]):
                T(c, SCX["desc"], y + 8 * j, s, 6.5)
            T(c, SCX["wd_r"] if t["amount"] < 0 else SCX["dep_r"], y, money(abs(t["amount"])), 7, align="r")
            T(c, SCX["bal_r"], y, money(shown), 7, align="r")
        doc(draw)
        y += hgt
    assert abs(bal - st["close"]) < 0.005
    if y > BOTTOM - 20:
        doc.new_page(); doc(lambda c: colhead(c, 60)); y = 78
    doc(lambda c, y=y: (T(c, SCX["date"], y + 4, f"{ld} {MON[m0]} {y0}", 7, "Helvetica-Bold"),
                        T(c, SCX["desc"], y + 4, "BALANCE CARRIED FORWARD", 7, "Helvetica-Bold"),
                        T(c, SCX["bal_r"], y + 4, money(bal), 7, "Helvetica-Bold", "r")))

    def footer(c, i, n):
        T(c, 28, 808, "This statement serves as a tax invoice for Goods and Services Tax purposes in Singapore.", 4.5)
        T(c, 28, 815, "Standard Chartered Bank (Singapore) Limited | Reg. No. 000000000X | GST Group Registration No. MR-0000000-0 | MOCK ADDRESS", 4.5)
        T(c, 562, 808, f"Page {i} of {n}", 6, align="r")

    doc.save(path, footer)


# =====================================================================================
# 6. Write files + expected results
# =====================================================================================
def truth_rows(rows):
    return [dict(date=t["date"].isoformat(), amount=t["amount"], first=t["lines"][0]) for t in rows]


def main():
    os.makedirs(EDGE, exist_ok=True)
    expected = {"files": {}, "notes": []}
    for i, (y, m) in enumerate(MONTHS):
        tag = f"{y}-{m:02d}"
        pl, ps, sv, s = statements["paylah"][i], statements["posb"][i], statements["saye"][: i + 1], statements["sc"][i]
        f = f"PayLah_{tag}.pdf"; render_paylah(pl, os.path.join(OUT, f))
        expected["files"][f] = dict(bank="paylah", transactions=len(pl["rows"]), errors=0, closing={"PayLah": pl["close"]}, net=r2(sum(t["amount"] for t in pl["rows"])))
        f = f"POSB_Consolidated_{tag}.pdf"; render_posb(ps, sv, os.path.join(OUT, f))
        saye_rows = [t for x in sv for t in x["rows"]]
        expected["files"][f] = dict(bank="posb", transactions=len(ps["rows"]) + len(saye_rows), errors=0,
                                    closing={"POSB Everyday Savings": ps["close"], "POSB SAYE": sv[-1]["close"], "Supplementary Retirement Scheme": 1.0},
                                    net=r2(sum(t["amount"] for t in ps["rows"] + saye_rows)))
        f = f"SC_JumpStart_{tag}.pdf"; render_sc(s, os.path.join(OUT, f))
        expected["files"][f] = dict(bank="sc", transactions=len(s["rows"]), errors=0, closing={"SC Jumpstart": s["close"]}, net=r2(sum(t["amount"] for t in s["rows"])))

    # ---------------- edge cases
    s = statements["sc"][2]
    render_sc(s, os.path.join(EDGE, "SC_2026-09_misprinted-balance.pdf"), misprint_row=6)
    expected["files"]["edge-cases/SC_2026-09_misprinted-balance.pdf"] = dict(bank="sc", transactions=len(s["rows"]), errors=2,
        why="Row 7's printed balance is off by S$1.00: that row and the next both fail the running-balance check.")
    pl = statements["paylah"][2]
    render_paylah(pl, os.path.join(EDGE, "PayLah_2026-09_missing-row.pdf"), drop_row=3)
    expected["files"]["edge-cases/PayLah_2026-09_missing-row.pdf"] = dict(bank="paylah", transactions=len(pl["rows"]) - 1, errors=1,
        why="One row is missing from the table, so previous balance + rows no longer equals the carried-forward balance.")

    from pypdf import PdfReader, PdfWriter
    w = PdfWriter(clone_from=os.path.join(OUT, "POSB_Consolidated_2026-09.pdf"))
    w.encrypt(user_password="MOCK1234", owner_password="MOCK1234-owner")
    with open(os.path.join(EDGE, "POSB_2026-09_password-MOCK1234.pdf"), "wb") as fh:
        w.write(fh)
    expected["files"]["edge-cases/POSB_2026-09_password-MOCK1234.pdf"] = dict(bank="posb", password="MOCK1234",
        transactions=expected["files"]["POSB_Consolidated_2026-09.pdf"]["transactions"], errors=0,
        why="Password-protected. The page should ask for the password (MOCK1234) and then parse cleanly; a wrong password re-prompts.")

    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
    for k, line in enumerate(["PayLah! Statement of Account (SCANNED IMAGE)", "MOCK - FICTIONAL TEST DATA", "", "01 Sep  SHOPEEPAY SG          4.47 DB", "05 Sep  KOPITIAM BEDOK MALL   3.20 DB"]):
        d.text((90, 120 + 48 * k), line, fill="black", font=font)
    buf = io.BytesIO(); img.save(buf, "PNG"); buf.seek(0)
    from reportlab.lib.utils import ImageReader
    c = canvas.Canvas(os.path.join(EDGE, "Scanned_photo_no-text-layer.pdf"), pagesize=A4)
    c.drawImage(ImageReader(buf), 0, 0, W, H); c.showPage(); c.save()
    expected["files"]["edge-cases/Scanned_photo_no-text-layer.pdf"] = dict(bank=None, transactions=0, errors=1, why="Image-only PDF with no text layer; the log should say OCR isn't supported.")

    c = canvas.Canvas(os.path.join(EDGE, "Unknown_bank_statement.pdf"), pagesize=A4)
    watermark(c)
    T(c, 50, 70, "ACME FICTIONAL BANK", 16, "Helvetica-Bold"); T(c, 50, 90, "Monthly Statement - September 2026", 9)
    T(c, 50, 130, "Date        Description              Debit      Credit     Balance", 8)
    T(c, 50, 145, "01/09/2026  Opening balance                                    1,000.00", 8)
    T(c, 50, 160, "03/09/2026  COFFEE SHOP                  4.50                    995.50", 8)
    c.showPage(); c.save()
    expected["files"]["edge-cases/Unknown_bank_statement.pdf"] = dict(bank=None, transactions=0, errors=1, why="Not one of the supported banks; the log should show the first lines it read.")

    with open(os.path.join(EDGE, "Not_actually_a_PDF.pdf"), "w") as fh:
        fh.write("This is a plain text file with a .pdf name.\n")
    expected["files"]["edge-cases/Not_actually_a_PDF.pdf"] = dict(bank=None, transactions=0, errors=1, why="Not a valid PDF; pdf.js should fail to open it and the log should say so.")

    # ---------------- combined expectations for the 9 clean files
    saye_unique = sum(len(x["rows"]) for x in statements["saye"])
    saye_listed = sum(len(x["rows"]) for i in range(3) for x in statements["saye"][: i + 1])
    total_rows = sum(v["transactions"] for k, v in expected["files"].items() if not k.startswith("edge-cases/"))
    expected["combined"] = dict(rows_in_files=total_rows, duplicates=saye_listed - saye_unique, unique=total_rows - (saye_listed - saye_unique),
                                paylah_topups=sum(1 for t in paylah if t["lines"][0].startswith("TOP UP") and t["date"] <= D(2026, 9, 22)),
                                posb_to_sc_transfers=3)
    expected["notes"] = [
        "Load all 9 files in /mocks (not edge-cases) together: every file should be 'clean' with all balance checks green.",
        f"The SAYE section is quarter-to-date, so {expected['combined']['duplicates']} SAYE rows repeat across files and should be reported as counted once.",
        "PayLah statements run 23rd -> 22nd, so the July file also contains late-June rows.",
        "SC card purchases post 0-2 days after purchase, so a few late-September purchases are not in any statement (realistic).",
        "Internal transfers that should be excluded from spending: PayLah top-ups (POSB out / PayLah in), monthly S$1,500 POSB -> SC, SAYE S$300, DBS credit card bill payment.",
        "Deliberately uncategorised merchants: ATM WITHDRAWAL, SHENG HUAT HARDWARE, ACME TECH salary is categorised as Salary.",
    ]
    with open(os.path.join(OUT, "expected.json"), "w") as fh:
        json.dump(expected, fh, indent=2)
    print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("transactions", "errors")} for k, v in expected["files"].items()}, indent=1))
    print(expected["combined"])


if __name__ == "__main__":
    main()
