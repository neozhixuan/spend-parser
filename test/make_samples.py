"""Generate synthetic statements that mimic the real PayLah / POSB / Standard Chartered layouts.
All names, numbers and merchants are fake. Used only to exercise the parsers."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import os

W, H = A4
OUT = os.path.join(os.path.dirname(__file__), "samples")
os.makedirs(OUT, exist_ok=True)


def top(c, y):  # use top-down coordinates
    return H - y


def r(c, x, y, s, size=8, font="Helvetica"):
    c.setFont(font, size)
    c.drawRightString(x, top(c, y), s)


def l(c, x, y, s, size=8, font="Helvetica"):
    c.setFont(font, size)
    c.drawString(x, top(c, y), s)


def ctr(c, x, y, s, size=8, font="Helvetica-Bold"):
    c.setFont(font, size)
    c.drawCentredString(x, top(c, y), s)


def money(v):
    return f"{v:,.2f}"


# ---------------------------------------------------------------- PayLah
def paylah():
    c = canvas.Canvas(f"{OUT}/paylah_sep.pdf", pagesize=A4)
    l(c, 50, 60, "PayLah!", 16, "Helvetica-Bold")
    l(c, 50, 78, "Statement of Account", 9)
    r(c, 545, 70, "DBS Bank Ltd", 5)
    l(c, 50, 120, "TAN AH KOW", 7)
    l(c, 50, 130, "TANAHKOW@EXAMPLE.COM", 7)
    ctr(c, 130, 170, "STATEMENT DATE", 7, "Helvetica")
    ctr(c, 290, 170, "MOBILE NUMBER", 7, "Helvetica")
    ctr(c, 450, 170, "WALLET ACCOUNT", 7, "Helvetica")
    ctr(c, 130, 184, "22 Sep 2026", 7)
    ctr(c, 290, 184, "91234567", 7)
    ctr(c, 450, 184, "8888880000000000", 7)
    l(c, 50, 205, "This statement serves as a TAX INVOICE if GST is charged.", 5)
    r(c, 545, 220, "Total: 894.92 CR", 7)
    l(c, 55, 240, "Account", 7, "Helvetica-Bold"); l(c, 200, 240, "Account No.", 7, "Helvetica-Bold"); r(c, 545, 240, "Balance", 7, "Helvetica-Bold")
    l(c, 55, 255, "PayLah! Wallet", 7); l(c, 200, 255, "8888880000000000", 7); r(c, 545, 255, "894.92 CR", 7)
    l(c, 55, 280, "DATE", 7, "Helvetica-Bold"); l(c, 110, 280, "DESCRIPTION", 7, "Helvetica-Bold"); r(c, 545, 280, "AMOUNT", 7, "Helvetica-Bold")
    l(c, 58, 300, "PayLah! Wallet", 6, "Helvetica-Bold")
    l(c, 58, 318, "PREVIOUS BALANCE", 7); r(c, 535, 318, "938.43 CR", 7)
    rows = [("24 Aug", "SHOPEEPAY SG", 4.47, "DB"), ("30 Aug", "SHOPEEPAY SG", 18.03, "DB"),
            ("01 Sep", "GOLDEN VILLAGE", 21.80, "DB"), ("05 Sep", "KOPITIAM BEDOK", 2.26, "DB"),
            ("16 Sep", "MR BEAN TAMPINES", 8.95, "DB"), ("18 Sep", "TOP UP FROM POSB", 50.00, "CR"),
            ("20 Sep", "RECEIVE MONEY FROM 91234567", 12.00, "CR"), ("21 Sep", "GRAB* TRANSPORT", 50.00, "DB")]
    y = 340
    for d, desc, amt, s in rows:
        l(c, 58, y, d, 7); l(c, 110, y, desc, 7, "Helvetica-Bold"); r(c, 535, y, f"{amt:.2f} {s}", 7)
        l(c, 115, y + 8, "REF NO.: MT17147259518614413", 5)
        y += 24
    r(c, 400, y + 10, "Total Balance Carried Forward:", 7, "Helvetica-Bold"); r(c, 535, y + 10, "894.92 CR", 7)
    l(c, 55, y + 50, "USEFUL INFORMATION ON YOUR DBS PAYLAH! WALLET", 7, "Helvetica-Bold")
    l(c, 55, y + 70, "Important Notice", 7, "Helvetica-Bold")
    c.save()


# ---------------------------------------------------------------- POSB
def posb_header(c, y):
    l(c, 45, y, "Date", 7, "Helvetica-Bold"); l(c, 110, y, "Description", 7, "Helvetica-Bold")
    ctr(c, 380, y, "Withdrawal (-)", 7); ctr(c, 460, y, "Deposit (+)", 7); ctr(c, 530, y, "Balance (SGD)", 7)


def posb_footer(c, n):
    l(c, 40, 800, "Transaction Details as of 30 Sep 2026", 7, "Helvetica-Bold"); r(c, 555, 800, f"Page {n} of 5", 7, "Helvetica-Bold")
    ctr(c, 300, 812, "PDS_MMCON_SPEC_ONSH_10c5013300000025_01391", 5, "Helvetica")
    c.saveState(); c.translate(20, 500); c.rotate(90); c.setFont("Helvetica", 4)
    c.drawString(0, 0, "SG4002000876 DBS Co. Reg. No. 196800306E GST Reg No: MR-8500180-3"); c.restoreState()


def posb_section(c, y, name):
    l(c, 48, y, name, 7, "Helvetica-Bold"); r(c, 552, y, "Account No. 000-00000-0", 7, "Helvetica-Bold")


def posb():
    c = canvas.Canvas(f"{OUT}/posb_sep.pdf", pagesize=A4)
    r(c, 555, 60, "Consolidated Statement", 10, "Helvetica-Bold")
    l(c, 50, 70, "TAN AH KOW", 7)
    l(c, 40, 200, "Account Summary as at 30 Sep 2026", 14, "Helvetica-Bold")
    l(c, 45, 260, "Account", 7, "Helvetica-Bold"); l(c, 230, 260, "Account No.", 7, "Helvetica-Bold"); r(c, 480, 260, "Balance", 7, "Helvetica-Bold")
    l(c, 45, 275, "POSB Everyday Savings Account", 7); l(c, 230, 275, "000-00000-0", 7); r(c, 480, 275, "23,368.84", 7)
    l(c, 45, 290, "POSB SAYE Account", 7); l(c, 230, 290, "000-00000-0", 7); r(c, 480, 290, "5,237.60", 7)
    posb_footer(c, 1); c.showPage()

    # page 2
    l(c, 40, 80, "Transaction Details as at 30 Sep 2026", 14, "Helvetica-Bold")
    posb_section(c, 110, "POSB Everyday Savings Account")
    posb_header(c, 125)
    bal = 18204.36
    l(c, 110, 145, "Balance Brought Forward", 7, "Helvetica-Bold"); r(c, 550, 145, money(bal), 7, "Helvetica-Bold")
    rows = [
        ("07/09/2026", ["Payments / Collections via GIRO", "GOV", "GOV", "OTHER"], 500.00),
        ("08/09/2026", ["FAST Payment / Receipt", "INCOMING PAYNOW REF 9181498", "FROM: JOHN LIM", "SEND BACK", "OTHER"], 20.00),
        ("12/09/2026", ["Monthly Savings Amount for MySavings/POSB", "SAYE Account", "TO MSA: 592303493"], -300.00),
        ("18/09/2026", ["Funds Transfer", "TOP-UP TO PAYLAH! : 88888800000"], -50.00),
        ("25/09/2026", ["Point-of-Sale Transaction", "NETS QR PAYMENT 2025091422556603", "TO: KIM SENG FOOD"], -6.30),
        ("29/09/2026", ["Salary", "ACME PTE LTD", "SAL", "2609"], 5000.00),
        ("30/09/2026", ["Interest Earned"], 0.78),
    ]
    y = 165
    sw = sd = 0
    for d, desc, amt in rows:
        bal = round(bal + amt, 2)
        l(c, 45, y, d, 7)
        for i, t in enumerate(desc):
            l(c, 110, y + i * 9, t, 7)
        if amt < 0:
            r(c, 405, y, money(-amt), 7); sw += -amt
        else:
            r(c, 485, y, money(amt), 7); sd += amt
        r(c, 550, y, money(bal), 7)
        y += 9 * len(desc) + 8
    l(c, 110, y, "Total Balance Carried Forward:", 7, "Helvetica-Bold")
    r(c, 405, y, money(sw), 7, "Helvetica-Bold"); r(c, 485, y, money(sd), 7, "Helvetica-Bold"); r(c, 550, y, money(bal), 7, "Helvetica-Bold")

    y += 25
    posb_section(c, y, "POSB SAYE Account"); posb_header(c, y + 15)
    sb = 4335.17
    y += 35
    l(c, 110, y, "Balance Brought Forward", 7, "Helvetica-Bold"); r(c, 550, y, money(sb), 7, "Helvetica-Bold")
    saye = [("12/07/2026", ["Monthly Savings Amount for MySavings/POSB", "SAYE Account", "FROM: 249771449"], 300.00),
            ("31/07/2026", ["Interest Earned"], 0.77),
            ("12/08/2026", ["Monthly Savings Amount for MySavings/POSB", "SAYE Account", "FROM: 249771449"], 300.00),
            ("31/08/2026", ["Interest Earned"], 0.82),
            ("12/09/2026", ["Monthly Savings Amount for MySavings/POSB", "SAYE Account", "FROM: 249771449"], 300.00)]
    y += 20
    for d, desc, amt in saye:
        sb = round(sb + amt, 2)
        l(c, 45, y, d, 7)
        for i, t in enumerate(desc):
            l(c, 110, y + i * 9, t, 7)
        r(c, 485, y, money(amt), 7); r(c, 550, y, money(sb), 7)
        y += 9 * len(desc) + 8
    l(c, 110, y, "Balance Carried Forward", 7, "Helvetica-Bold"); r(c, 550, y, money(sb), 7, "Helvetica-Bold")
    posb_footer(c, 2); c.showPage()

    # page 3: SAYE continues, then SRS
    posb_section(c, 90, "POSB SAYE Account"); posb_header(c, 105)
    l(c, 110, 125, "Balance Brought Forward", 7, "Helvetica-Bold"); r(c, 550, 125, money(sb), 7, "Helvetica-Bold")
    sb = round(sb + 0.84, 2)
    l(c, 45, 142, "30/09/2026", 7); l(c, 110, 142, "Interest Earned", 7); r(c, 485, 142, "0.84", 7); r(c, 550, 142, money(sb), 7)
    l(c, 110, 160, "Total Balance Carried Forward:", 7, "Helvetica-Bold"); r(c, 405, 160, "0.00", 7); r(c, 485, 160, "902.43", 7); r(c, 550, 160, money(sb), 7)
    l(c, 50, 190, "Supplementary Retirement Scheme", 9, "Helvetica-Bold")
    posb_section(c, 210, "Supplementary Retirement Scheme Account"); posb_header(c, 225)
    l(c, 110, 245, "Balance Brought Forward", 7, "Helvetica-Bold"); r(c, 550, 245, "1.00", 7)
    l(c, 110, 262, "Total Balance Carried Forward:", 7, "Helvetica-Bold"); r(c, 550, 262, "1.00", 7)
    posb_footer(c, 3); c.showPage()

    l(c, 50, 90, "Messages For You", 11, "Helvetica-Bold")
    l(c, 50, 110, "Best execution policy for handling of customers' orders 01/01/2026 12.00", 7)
    posb_footer(c, 4); c.save()


# ---------------------------------------------------------------- Standard Chartered
SC_COLS = dict(date=45, desc=95, dep_c=287, wd_c=398, bal_c=510, dep_r=335, wd_r=440, bal_r=560)


def sc_header(c, y):
    l(c, SC_COLS["date"] + 5, y, "Date", 7, "Helvetica-Bold"); ctr(c, 180, y, "Description", 7)
    ctr(c, SC_COLS["dep_c"], y, "Deposit", 7); ctr(c, SC_COLS["wd_c"], y, "Withdrawal", 7); ctr(c, SC_COLS["bal_c"], y, "Balance", 7)


def sc_footer(c, n):
    l(c, 30, 815, "This statement serves as a tax invoice for Goods and Services Tax purposes in Singapore.", 4)
    l(c, 30, 822, "Standard Chartered Bank (Singapore) Limited | Reg. No. 201224747C | GST Group Registration No. MR-8500053-0", 4)
    r(c, 560, 815, f"Page {n} of 3", 6)


def sc(broken=False):
    name = "sc_sep_broken.pdf" if broken else "sc_sep.pdf"
    c = canvas.Canvas(f"{OUT}/{name}", pagesize=A4)
    ctr(c, 230, 45, "Statement of Account", 12)
    l(c, 50, 110, "TAN AH KOW", 7); l(c, 50, 119, "123", 7); l(c, 50, 128, "RIVERSIDE CRESCENT", 7); l(c, 50, 137, "SINGAPORE 123456", 7)
    l(c, 345, 110, "Statement Date", 7); l(c, 420, 110, ": 30 Sep 2026", 7)
    l(c, 30, 255, "JUMPSTART", 8, "Helvetica-Bold"); r(c, 560, 255, "0101-0-000000 (SGD)", 7)
    ctr(c, 300, 272, "Cashback Summary Table for the month of August 2026", 7)
    l(c, 30, 285, "Mastercard Spend", 7); r(c, 210, 285, "945.32", 7); l(c, 215, 285, "Cashback", 7); r(c, 330, 285, "9.45", 7)
    l(c, 340, 285, "Average Daily Balance", 7); r(c, 560, 285, "4,659.60", 7)
    sc_header(c, 302)
    bal = 4133.76
    l(c, SC_COLS["date"], 320, "31 Aug 2026", 7); l(c, SC_COLS["desc"], 320, "BALANCE FROM PREVIOUS STATEMENT", 7, "Helvetica-Bold")
    r(c, SC_COLS["bal_r"], 320, money(bal), 7, "Helvetica-Bold")
    rows = [
        ("01 Sep 2026", ["08/28", "TRANSIT 30750455157996", "SGD 20.00", "VALUE DATE AS OF 28 AUG"], -20.00),
        ("01 Sep 2026", ["08/31", "SP DIGITAL PTE LTD", "SGD 3.50", "VALUE DATE AS OF 31 AUG"], -3.50),
        ("01 Sep 2026", ["CASHBACK", "VALUE DATE AS OF 31 AUG"], 9.45),
        ("04 Sep 2026", ["09/02", "SHOPEE SINGAPORE MP 300006472605", "SGD 20.00", "VALUE DATE AS OF 02 SEP"], -20.00),
        ("05 Sep 2026", ["09/03", "DECATHLON SINGAPORE", "SGD 16.90", "VALUE DATE AS OF 03 SEP"], -16.90),
        ("05 Sep 2026", ["09/04", "GRAB* A-8F2KWWVDAAV", "SGD 10.00", "VALUE DATE AS OF 04 SEP"], -10.00),
        ("07 Sep 2026", ["09/05", "NETFLIX.COM", "USD 12.00", "VALUE DATE AS OF 05 SEP"], -16.40),
        ("08 Sep 2026", ["09/07", "BEDOK FOOD CENTRE", "SGD 12.40", "VALUE DATE AS OF 07 SEP"], -12.40),
    ]
    y = 340
    for i, (d, desc, amt) in enumerate(rows):
        bal = round(bal + amt, 2)
        shown = bal
        if broken and i == 4:
            shown = round(bal - 1.00, 2)  # simulate a misprinted / misread balance
        l(c, SC_COLS["date"], y, d, 7)
        for j, t in enumerate(desc):
            l(c, SC_COLS["desc"], y + j * 8, t, 6.5)
        if amt < 0:
            r(c, SC_COLS["wd_r"], y, money(-amt), 7)
        else:
            r(c, SC_COLS["dep_r"], y, money(amt), 7)
        r(c, SC_COLS["bal_r"], y, money(shown), 7)
        if broken and i == 4:
            bal = shown
        y += 8 * len(desc) + 12
    sc_footer(c, 1); c.showPage()

    # page 2: name repeated at top, header repeated, more rows, closing line
    l(c, 50, 60, "TAN AH KOW", 7)
    sc_header(c, 90)
    l(c, SC_COLS["date"], 108, "08 Sep 2026", 7); l(c, SC_COLS["desc"], 108, "BALANCE BROUGHT FORWARD", 7, "Helvetica-Bold"); r(c, SC_COLS["bal_r"], 108, money(bal), 7)
    more = [("15 Sep 2026", ["FAST PAYMENT", "TO POSB 249771449", "OTHER"], -200.00),
            ("28 Sep 2026", ["INTEREST CREDIT"], 0.35)]
    y = 128
    for d, desc, amt in more:
        bal = round(bal + amt, 2)
        l(c, SC_COLS["date"], y, d, 7)
        for j, t in enumerate(desc):
            l(c, SC_COLS["desc"], y + j * 8, t, 6.5)
        if amt < 0:
            r(c, SC_COLS["wd_r"], y, money(-amt), 7)
        else:
            r(c, SC_COLS["dep_r"], y, money(amt), 7)
        r(c, SC_COLS["bal_r"], y, money(bal), 7)
        y += 8 * len(desc) + 12
    l(c, SC_COLS["date"], y, "30 Sep 2026", 7); l(c, SC_COLS["desc"], y, "BALANCE CARRIED FORWARD", 7, "Helvetica-Bold"); r(c, SC_COLS["bal_r"], y, money(bal), 7)
    sc_footer(c, 2); c.save()


if __name__ == "__main__":
    paylah(); posb(); sc(); sc(broken=True)
    print("written to", OUT)
