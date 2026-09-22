# -*- coding: utf-8 -*-
"""
Character-count every X post the way X counts them.

A raw len() is not the number that matters: X counts any URL as 23
characters regardless of its real length, which is why a post reading 271
locally can be rejected at 281. CD3 was exactly that.
"""
import re, sys

LIMIT = 280
URL = re.compile(
    r'\b(?:https?://\S+|(?:[a-z0-9-]+\.)+(?:xyz|com|org|io|net|eth|app|dev)(?:/\S*)?)\b',
    re.I,
)

POSTS = {
"T1": """NVIDIA splits 10:1. $1,000 becomes $100 overnight.

Nothing about the company changed. Nobody lost a cent.

Every oracle on chain publishes that number with a ±2.9% band — and tells every lender to liquidate everything.

tapeguard refuses it.

24 Sept · 16:00 UTC""",

"T2": """The test isn't "is this move large".

It's: the move is impossible as a price move, yet dividing by exactly one clean split ratio leaves an ordinary gap.

-90.00% is 126 sigma.
Divide by 0.1000 → 0.0 sigma.

A crash doesn't land on a clean fraction. A split always does.""",

"T3": """A trading halt is on no calendar.

Session says REGULAR. The tape is scheduled open. Prints just stop.

The hard part isn't noticing the silence. It's telling "the exchange stopped" apart from "your vendor stopped" — through one connection those are the same observation.""",

"T4": """Two years of gaps per ticker: ~8 earnings nights against ~500 ordinary ones.

1.6% of the sample.

So a model can miss every single earnings night and still report 95% coverage — while failing on exactly the nights a lender is most exposed.

We score them separately.""",

"T5": """Three vendors agreeing on one IEX tape is one source wearing three hats.

The median can't outvote a bad print they all inherited. Their spread is zero for the same reason a single source's is: nothing there to disagree.

So we count feeds, not vendors.""",

"T6": """Our first calibration got 90.2% coverage against a stated 95%.

Not a tuning problem. A 1.96x multiplier only delivers 95% if the distribution is normal, and gap distributions are fat-tailed.

Fixed by fitting the quantile we actually claim.

97.0% out of sample.""",

"T7": """A 4:3 split takes the price to 0.75 of the anchor.

So does a 25% drop on a bad quarter.

From price alone those are the same observation. No threshold separates them, because there's nothing there to separate.

So we refuse the price and don't claim the split.""",

"T8": """Reads refuse by default, and the revert says which guard stopped you.

getPriceIfSafe("NVDA", 600)
→ revert Flagged(flags: 3, disallowed: 3)

getPriceIfSafe("NVDA", 600, EARNINGS|SPLIT)
→ 180.00000000

Opting into a risk is a decision. Not a workaround for a revert.""",

"T9": """tapeguard is live.

Eight instruments. Two independent feeds. Four guards: splits, halts, earnings, feed independence.

88 tests. Sigmas fitted on two years of realised gaps, scored out of sample.

Evaluation build, unaudited.

tapeguard.xyz

CA: [PASTE]""",

"CD1": """T-36h.

Six reasons tapeguard will refuse you a price:

SPLIT_PENDING
EARNINGS_WINDOW
DISCONTINUITY
SOURCE_DIVERGENT
SINGLE_SOURCE
HALT_UNCONFIRMED

Every one of them is a number that looked fine.""",

"CD2": """T-24h.

97.0% — out-of-sample coverage against a 95% claim
70.0% — coverage on the worst decile, where earnings nights live

That 27-point gap is the whole argument for treating earnings as its own regime.

Most feeds publish the first and never compute the second.""",

"CD3": """T-6h.

The feed is already running. Eight instruments, two independent feeds.

Watch it at the opening bell: provenance flips to TRADED and the band collapses from a few percent to single-digit basis points.

That transition is the product.

tapeguard.xyz""",

"CD4": """T-1h.

Before the address goes out, what we don't claim:

· The contracts are unaudited.
· The default source isn't licensed for production.
· The signer threshold ships at 1.

All three are on the site and in /api/health.

A feed that hides its limits is what this replaces.""",
}


def weighted(s: str) -> int:
    return len(URL.sub("", s)) + 23 * len(URL.findall(s))


def main() -> int:
    over = 0
    for k, v in POSTS.items():
        w = weighted(v)
        urls = len(URL.findall(v))
        room = LIMIT - w
        state = "OK" if w <= LIMIT else f"OVER by {w - LIMIT}"
        if w > LIMIT:
            over += 1
        print(f"  {k:<5} {w:>3}/280  room {room:>3}  {'url ' + str(urls) + '  ' if urls else '      '}{state}")
    print()
    print("  all within the limit" if over == 0 else f"  {over} post(s) need trimming")
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
