"""
Every social visual, from one renderer.

Data in, cards out. The numbers are pasted from the project's own test and
calibration output rather than retyped, because a marketing image that
disagrees with the repo is the fastest way to lose the only audience this
product can win: people who will check.
"""
import sys
from pathlib import Path
from PIL import ImageDraw
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cards import (canvas, font, save, mark, draw_runs,
                   FG, MUTED, DIM, REFUSE, SAFE, WARN, LINE, ROOT)

W, H = 1600, 900
PAD = 96
OUT = "brand/social"


def base(eyebrow=None):
    img = canvas(W, H)
    d = ImageDraw.Draw(img)
    unit = 13
    mark(d, PAD, 74, unit)
    d.text((PAD + unit * 4 + 20, 62), "tapeguard", font=font(30), fill=FG)
    d.text((W - PAD, 68), "tapeguard.xyz", font=font(22), fill=DIM, anchor="ra")
    if eyebrow:
        d.text((PAD, 168), eyebrow.upper(), font=font(20), fill=DIM)
    return img, d


def headline(d, y, lines, size=62, colour=FG, lead=1.28):
    for i, ln in enumerate(lines):
        d.text((PAD, y + int(i * size * lead)), ln, font=font(size), fill=colour)
    return y + int(len(lines) * size * lead)


def code(d, y, rows, size=30, lead=1.52):
    """rows: list of [(text, colour), ...] or None for a blank line."""
    for i, row in enumerate(rows):
        yy = y + int(i * size * lead)
        if row:
            draw_runs(d, PAD, yy, row, size)
    return y + int(len(rows) * size * lead)


def rule(d, y, width=None):
    w = width or (W - PAD * 2)
    d.rectangle([PAD, y, PAD + w, y + 1], fill=LINE)


def footer(d, text, colour=DIM):
    d.text((PAD, H - 92), text, font=font(24), fill=colour)


# ---------------------------------------------------------------- the cards

def c_split():
    img, d = base("corporate actions")
    headline(d, 226, ["A 10:1 split is a 90% drop", "against a ±2.9% band."], 58)
    y = code(d, 430, [
        [("anchor  ", DIM), ("1800.00", FG), ("   ->   price  ", DIM), ("180.00", FG)],
        [("move    ", DIM), ("-90.00%", FG), ("   =    ", DIM), ("126 sigma", REFUSE)],
        None,
        [("/ 0.1000", FG), ("  ->  ", DIM), ("0.0 sigma", SAFE), ("   an ordinary gap", DIM)],
    ])
    rule(d, y + 22)
    d.text((PAD, y + 56), "DISCONTINUITY | SPLIT_PENDING", font=font(34), fill=REFUSE)
    footer(d, "A crash does not land on a clean fraction. A split always does.")
    return save(img, f"{OUT}/card-split.png")


def c_fields():
    img, d = base("the design")
    headline(d, 226, ["Two fields, because there", "are two questions."], 58)
    y = code(d, 434, [
        [("provenance", FG), ("   where did this number come from?", DIM)],
        [("flags", FG), ("        why should you not act on it?", DIM)],
        None,
        [("A stock splitting tomorrow has a perfect live print today.", MUTED)],
        [("One enum must call that TRADED (true, and dangerous)", MUTED)],
        [("or STALE (false, the price is seconds old).", MUTED)],
    ], 28)
    rule(d, y + 20)
    footer(d, "Every oracle in production carries one enum.")
    return save(img, f"{OUT}/card-fields.png")


def c_halt():
    img, d = base("trading halts")
    headline(d, 226, ["A halt is on no calendar."], 58)
    y = code(d, 380, [
        [("session ", DIM), ("REGULAR", FG), ("        the tape is scheduled open", DIM)],
        [("prints  ", DIM), ("stopped 395s ago", REFUSE)],
        None,
        [("2 independent feeds agree  ->  ", DIM), ("HALTED", REFUSE)],
        [("1 feed only                ->  ", DIM), ("unconfirmed, and says so", WARN)],
    ], 28)
    rule(d, y + 20)
    footer(d, "The exchange stopping and your vendor stopping are the same "
              "observation through one connection.")
    return save(img, f"{OUT}/card-halt.png")


def c_earnings():
    img, d = base("earnings")
    headline(d, 226, ["Miss every earnings night,", "still report 95%."], 58)
    y = code(d, 434, [
        [("~8", FG), ("    earnings gaps per ticker, per two years", DIM)],
        [("~500", FG), ("  ordinary gaps beside them", DIM)],
        [("1.6%", REFUSE), ("  of the sample — invisible to a headline", DIM)],
        None,
        [("and they are the nights a lender is most exposed.", MUTED)],
    ], 28)
    rule(d, y + 20)
    footer(d, "So earnings coverage is scored on its own, or it is not scored.")
    return save(img, f"{OUT}/card-earnings.png")


def c_feeds():
    img, d = base("feed independence")
    headline(d, 226, ["Three vendors on one tape", "is one source in three hats."], 54)
    y = code(d, 430, [
        [("The median cannot outvote a bad print they all inherited.", MUTED)],
        [("Their spread is zero for the same reason a single source's is:", MUTED)],
        [("there is nothing there to disagree.", MUTED)],
        None,
        [("so corroboration counts ", DIM), ("feeds", FG), (", not vendors.", DIM)],
    ], 28)
    rule(d, y + 20)
    footer(d, "/api/health reports canCorroborateHalts, and says false when it is.")
    return save(img, f"{OUT}/card-feeds.png")


def c_calibration():
    img, d = base("calibration")
    headline(d, 226, ["Fit the quantile you claim."], 58)
    y = code(d, 380, [
        [("from a standard deviation   ", DIM), ("90.2%", REFUSE), ("  against a stated 95%", DIM)],
        [("from the 95th percentile    ", DIM), ("97.0%", SAFE), ("  out of sample", DIM)],
        None,
        [("1.96x only delivers 95% if the distribution is normal.", MUTED)],
        [("Gap distributions are not.", MUTED)],
    ], 28)
    rule(d, y + 20)
    d.text((PAD, y + 54), "fitted on the first 60%, scored on the last 40%",
           font=font(26), fill=MUTED)
    footer(d, "An in-sample number for a quantile-fitted band is arithmetic, not evidence.")
    return save(img, f"{OUT}/card-calibration.png")


def c_bounded():
    img, d = base("bounding the claim")
    headline(d, 226, ["A 4:3 split and a bad quarter", "look identical."], 54)
    y = code(d, 430, [
        [("10:1  -> 0.100   ", DIM), ("153 sigma from no move", SAFE), ("   claimed", DIM)],
        [(" 2:1  -> 0.500   ", DIM), (" 38 sigma", SAFE), ("               claimed", DIM)],
        [(" 4:3  -> 0.750   ", DIM), (" 16 sigma", WARN), ("               refused, not claimed", DIM)],
        None,
        [("Price alone cannot separate those two. So it does not try.", MUTED)],
    ], 28)
    rule(d, y + 20)
    footer(d, "Refused either way. It names the candidate and defers to the feed.")
    return save(img, f"{OUT}/card-bounded.png")


def c_contract():
    img, d = base("on chain")
    headline(d, 226, ["The revert tells you", "which guard stopped you."], 58)
    y = code(d, 430, [
        [("getPriceIfSafe(", MUTED), ("\"NVDA\"", FG), (", 600)", MUTED)],
        [("  -> revert ", DIM), ("Flagged(flags: 3, disallowed: 3)", REFUSE)],
        None,
        [("getPriceIfSafe(", MUTED), ("\"NVDA\"", FG), (", 600, EARNINGS|SPLIT)", MUTED)],
        [("  -> ", DIM), ("180.00000000", SAFE), ("      explicit opt-in", DIM)],
    ], 28)
    rule(d, y + 20)
    footer(d, "Reads refuse by default. Widening the mask is a decision, not a workaround.")
    return save(img, f"{OUT}/card-contract.png")


def c_tests():
    img, d = base("built in the open")
    headline(d, 226, ["88 tests. Every number", "on this account is from them."], 54)
    y = code(d, 434, [
        [("65", FG), ("  engine tests     ", DIM), ("session, guards, verdict, calibration", DIM)],
        [("23", FG), ("  contract tests   ", DIM), ("EIP-712, threshold, refusing reads", DIM)],
        None,
        [("Zero runtime dependencies in the guard engine.", MUTED)],
        [("No build step. The contract ABI is generated, never hand-kept.", MUTED)],
    ], 26)
    rule(d, y + 20)
    footer(d, "github.com/tapeguard/tapeguard")
    return save(img, f"{OUT}/card-tests.png")


def countdown(tag, hours, eyebrow, lines, detail, name):
    img, d = base(eyebrow)
    d.text((W - PAD, 168), tag, font=font(20), fill=WARN, anchor="ra")
    headline(d, 232, lines, 56)
    y = code(d, 448, detail, 28)
    rule(d, y + 24)
    d.text((PAD, y + 58), "Pons V2  ·  24 Sept 2026  ·  16:00 UTC", font=font(28), fill=FG)
    d.text((W - PAD, y + 58), hours, font=font(40), fill=WARN, anchor="ra")
    return save(img, f"{OUT}/{name}.png")


def main():
    made = [
        c_split(), c_fields(), c_halt(), c_earnings(), c_feeds(),
        c_calibration(), c_bounded(), c_contract(), c_tests(),
        countdown("T-36H", "36h", "countdown", 
                  ["Everything it refuses,", "and why."],
                  [[("SPLIT_PENDING    ", FG), ("a corporate action makes this incomparable", DIM)],
                   [("EARNINGS_WINDOW  ", FG), ("a release sits inside the window priced", DIM)],
                   [("DISCONTINUITY    ", FG), ("impossible as a price move", DIM)],
                   [("SOURCE_DIVERGENT ", FG), ("sources disagree, or one lags", DIM)],
                   [("SINGLE_SOURCE    ", FG), ("one feed wearing several hats", DIM)],
                   [("HALT_UNCONFIRMED ", FG), ("suspected, not corroborable", DIM)]],
                  "cd-36h"),
        countdown("T-24H", "24h", "countdown",
                  ["The band is fitted,", "and it is scored twice."],
                  [[("97.0%", SAFE), ("   out-of-sample coverage against a 95% claim", DIM)],
                   [("70.0%", REFUSE), ("   on the worst decile — where earnings live", DIM)],
                   [("k = 0.322", FG), ("  fitted time exponent (sqrt-t would be 0.500)", DIM)],
                   None,
                   [("The gap between those first two numbers is the whole argument.", MUTED)]],
                  "cd-24h"),
        countdown("T-6H", "6h", "countdown",
                  ["Live feed, eight instruments,", "two independent feeds."],
                  [[("HOOD  COIN  NVDA  TSLA  AAPL  MSTR  SPY  TLT", FG)],
                   None,
                   [("Every row carries where the number came from", MUTED)],
                   [("and why not to use it.", MUTED)],
                   None,
                   [("tapeguard.xyz", FG), ("   — it is already running", DIM)]],
                  "cd-6h"),
        countdown("T-1H", "1h", "countdown",
                  ["One hour.", "The contract address follows."],
                  [[("Evaluation build. Contracts unaudited.", WARN)],
                   [("Default data source is not licensed for production.", WARN)],
                   None,
                   [("Both stated on the site, in the README, and in /api/health.", MUTED)],
                   [("A feed that hides its limits is the thing this replaces.", MUTED)]],
                  "cd-1h"),
    ]
    for p in made:
        print(f"  {p.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
