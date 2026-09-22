# tapeguard — launch content kit

**Launch:** Pons V2 · 24 Sept 2026 · 16:00 UTC (= 23:00 WIB = 12:00 ET)
**First post:** 22 Sept, 23:00 WIB — exactly 48h before.

All copy and visuals are in English. Times are given in WIB for you,
with ET/UTC beside them because that is what the audience is on.

Conversion: **WIB − 11 = ET**, **WIB − 7 = UTC**.

Why these slots: this is a markets product, so the strongest windows are the
US equity session boundaries — 09:30 ET (open) and 16:00 ET (close) — plus
US midday and the crypto evening. Two of those fall in the middle of the
night in Jakarta, which is why everything here is scheduled, not live-posted.

---

## Profiles

### X — @tapeguard

**Name:** `tapeguard`

**Bio** (155 char limit):
```
The price, and the reason not to use it. Session-aware equity feeds for
Robinhood Chain that refuse by default. Splits · halts · earnings.
```

**Location:** `Robinhood Chain 4663`
**Website:** `tapeguard.xyz`
**PFP:** `brand/social/pfp-400.png`
**Banner:** `brand/social/banner.png`

**Pinned after launch:** T1 (the teaser).

### Telegram — t.me/tapeguard

**Name:** `tapeguard`
**PFP:** `brand/social/pfp-512.png`

**Description:**
```
A correctness layer for tokenised-equity price oracles on Robinhood Chain.

A price can be live, accurate, and still wrong to act on — a split, a halt,
an earnings gap. tapeguard publishes the price together with the reason you
should not act on it, and refuses by default when there is one.

Site        tapeguard.xyz
Code        github.com/tapeguard/tapeguard
Evaluation build. Contracts unaudited. Do not settle real money against it.
```

---

## Schedule

| # | WIB | ET / UTC | Post | Visual |
|---|---|---|---|---|
| 1 | **Mon 22, 23:00** | 12:00 ET · 16:00 UTC | **T1 — teaser video** | `tapeguard-teaser.mp4` |
| 2 | Tue 23, 03:00 | 16:00 ET Mon (close) | T2 — the split | `card-split.png` |
| 3 | Tue 23, 07:00 | 20:00 ET Mon | **TG1** | `card-fields.png` |
| 4 | Tue 23, 11:00 | 00:00 ET Tue | **CD1 — T-36h** | `cd-36h.png` |
| 5 | Tue 23, 20:30 | 09:30 ET (open) | T3 — the halt | `card-halt.png` |
| 6 | Tue 23, 23:00 | 12:00 ET | **CD2 — T-24h** | `cd-24h.png` |
| 7 | Wed 24, 03:00 | 16:00 ET Tue (close) | T4 — earnings | `card-earnings.png` |
| 8 | Wed 24, 07:00 | 20:00 ET Tue | **TG2** | `card-earnings.png` |
| 9 | Wed 24, 11:00 | 00:00 ET Wed | T5 — feed independence | `card-feeds.png` |
| 10 | Wed 24, 14:00 | 03:00 ET | **TG3** | `card-calibration.png` |
| 11 | Wed 24, 17:00 | 06:00 ET | **CD3 — T-6h** | `cd-6h.png` |
| 12 | Wed 24, 20:30 | 09:30 ET (open) | T6 — calibration | `card-calibration.png` |
| 13 | Wed 24, 21:00 | 10:00 ET | T7 — bounding the claim | `card-bounded.png` |
| 14 | Wed 24, 21:30 | 10:30 ET | **TG4** | `card-board.png` |
| 15 | Wed 24, 22:00 | 11:00 ET | **CD4 — T-1h** | `cd-1h.png` |
| 16 | Wed 24, 22:30 | 11:30 ET | T8 — integrating | `card-contract.png` |
| 17 | **Wed 24, 23:00** | **16:00 ET · 16:00 UTC** | **T9 — LAUNCH** | `card-board.png` |
| 18 | Wed 24, 23:05 | — | **TG5 — launch** | `card-board.png` |

---

## X posts

### T1 — Mon 22, 23:00 WIB · VIDEO
**Media:** `brand/video/tapeguard-teaser.mp4`

```
NVIDIA splits 10:1. $1,000 becomes $100 overnight.

Nothing about the company changed. Nobody lost a cent.

But every oracle on chain publishes that number with a ±2.9% band —
and tells every lending protocol to liquidate every position at once.

tapeguard refuses it.

24 Sept · 16:00 UTC
```

### T2 — Tue 23, 03:00 WIB
**Media:** `card-split.png`

```
The test is not "is this move large".

It is: the raw move is impossible as a price move, yet dividing it by
exactly one clean split ratio leaves an ordinary overnight gap.

-90.00% is 126 sigma.
Divide by 0.1000 and you get 0.0 sigma.

A crash does not land on a clean fraction. A split always does.
```

### T3 — Tue 23, 20:30 WIB
**Media:** `card-halt.png`

```
A trading halt is on no calendar.

The session says REGULAR. The tape is scheduled open. Prints just stop.

The hard part isn't noticing the silence — it's telling apart
"the exchange stopped" from "your vendor stopped". Through one
connection those are the same observation.

So with one feed, tapeguard refuses and says the call is unconfirmed.
It doesn't dress a guess as a detection.
```

### T4 — Wed 24, 03:00 WIB
**Media:** `card-earnings.png`

```
Two years of gaps per ticker: about 8 earnings nights against ~500
ordinary ones.

1.6% of the sample.

Which means a model can miss every single earnings night and still
report 95% coverage — while failing on precisely the nights a lender
is most exposed.

A headline number is structurally blind to this. So we score it separately.
```

### T5 — Wed 24, 11:00 WIB
**Media:** `card-feeds.png`

```
Three vendors agreeing on one IEX tape is one source wearing three hats.

The median can't outvote a bad print they all inherited. Their spread is
zero for the same reason a single source's is: there's nothing there to
disagree.

So tapeguard counts feeds, not vendors. A halt is "corroborated" only
across two genuinely different ones.
```

### T6 — Wed 24, 20:30 WIB
**Media:** `card-calibration.png`

```
Our first calibration got 90.2% coverage against a stated 95%.

That wasn't a tuning problem. A 1.96x multiplier only delivers 95% if the
distribution is normal, and gap distributions are fat-tailed — so any
moment-based estimate lands short.

Fixed by fitting the quantile we actually claim: the 95th percentile.

97.0% out of sample. Fitted on the first 60% of history, scored on the
last 40%, because an in-sample number for a quantile-fitted band is
arithmetic, not evidence.
```

### T7 — Wed 24, 21:00 WIB
**Media:** `card-bounded.png`

```
A 4:3 split takes the price to 0.75 of the anchor.

So does a 25% drop on a bad quarter.

From price alone those are the same observation, and no threshold
separates them — because there's nothing there to separate.

So tapeguard refuses the price and does NOT claim the split. It names
the candidate and defers to the corporate-actions feed.

A guard that resolved that coin flip with a decimal point would be guessing.
```

### T8 — Wed 24, 22:30 WIB
**Media:** `card-contract.png`

```
Reads refuse by default, and the revert tells you which guard stopped you.

getPriceIfSafe("NVDA", 600)
  -> revert Flagged(flags: 3, disallowed: 3)

getPriceIfSafe("NVDA", 600, EARNINGS_WINDOW | SPLIT_PENDING)
  -> 180.00000000

Opting into a risk is a decision you make explicitly, having read what
it means. It is not a workaround for a revert.
```

### T9 — Wed 24, 23:00 WIB · LAUNCH
**Media:** `card-board.png`

```
tapeguard is live.

Eight instruments. Two independent feeds. Four guards: corporate actions,
trading halts, earnings windows, feed independence.

88 tests. Sigmas fitted against two years of realised gaps, scored out
of sample. Zero runtime dependencies in the guard engine.

Evaluation build — contracts unaudited, and the site says so.

tapeguard.xyz

CA: [paste]
```

---

## Countdown posts

Each carries something the others don't. A countdown with nothing in it
teaches the timeline to scroll past you.

### CD1 — Tue 23, 11:00 WIB · T-36h
**Media:** `cd-36h.png`

```
T-36h.

Six reasons tapeguard will refuse you a price:

SPLIT_PENDING     a corporate action makes it incomparable
EARNINGS_WINDOW   a release sits inside the window being priced
DISCONTINUITY     impossible as a price move
SOURCE_DIVERGENT  sources disagree, or one is lagging
SINGLE_SOURCE     one feed wearing several hats
HALT_UNCONFIRMED  suspected, not corroborable

Every one of them is a number that looked fine.
```

### CD2 — Tue 23, 23:00 WIB · T-24h
**Media:** `cd-24h.png`

```
T-24h.

97.0% — out-of-sample coverage against a 95% claim
70.0% — coverage on the worst decile, where earnings nights live

That 27-point gap is the entire argument for treating earnings as its own
regime. Most feeds publish the first number and never compute the second.

k = 0.322, fitted. Square-root-of-time would be 0.500 — calendar time is a
poor clock for market risk.
```

### CD3 — Wed 24, 17:00 WIB · T-6h
**Media:** `cd-6h.png`

```
T-6h.

The feed is already running. HOOD COIN NVDA TSLA AAPL MSTR SPY TLT,
two independent feeds, refreshing now.

Right now every row reads REFUSED — because the tape is shut and the
price was never printed. That is the correct answer, not an outage.

Watch it flip at the opening bell: tapeguard.xyz
```

### CD4 — Wed 24, 22:00 WIB · T-1h
**Media:** `cd-1h.png`

```
T-1h.

Before the address goes out, the parts we are not claiming:

· The contracts are unaudited.
· The default price source is not licensed for production use.
· The signer threshold ships at 1. It is a parameter, not a redeploy —
  but until it is raised, the trust assumption is one key.

All three are on the site, in the README, and in /api/health.

A feed that hides its limits is the thing this replaces.
```

---

## Telegram posts

Longer form. Telegram readers will actually read a paragraph.

### TG1 — Tue 23, 07:00 WIB
**Media:** `card-fields.png`

```
Why tapeguard carries two fields instead of one

Every oracle in production returns a price with a single status enum.
That enum has to answer two different questions at once, and it can't.

  provenance — where did this number come from?
  flags      — why should you not act on it right now?

Here is the case that breaks a single enum. A stock is splitting 10:1
tomorrow morning. Today's price is a perfect live print: observed, accurate,
seconds old. The provenance is genuinely TRADED.

And the number becomes incomparable in sixteen hours.

Forced into one field you must choose between saying TRADED — true, and
dangerous — or STALE, which is simply false. Neither is the answer. So we
carry both: provenance says where it came from, flags say why not to use it,
and several flags can be raised at once.

Reads refuse by default, and the revert names the offending flags, so a
caller learns which guard stopped it rather than only that something did.

tapeguard.xyz/docs
```

### TG2 — Wed 24, 07:00 WIB
**Media:** `card-earnings.png`

```
The earnings night a backtest cannot see

Gap distributions are bimodal: ordinary nights, and the four a year a
company reports. Two years of history gives roughly eight earnings gaps
per ticker against five hundred ordinary ones.

That is 1.6% of the sample.

So a model can miss every single earnings night and still publish 95%
coverage — and those are exactly the nights a lending protocol is most
exposed. Headline coverage is structurally incapable of showing it.

Our own fit makes the point. Overall out-of-sample coverage: 97.0%.
Coverage on the worst decile of gaps, where earnings nights live: 70.0%.

Same model. Same data. One number reassures, the other doesn't.

So the earnings guard runs BEFORE the discontinuity check, because it sets
the sigma that check measures against. NVDA reporting and opening 25% lower
is a real price the market made — 16 sigma of an ordinary night, 4.5 of an
earnings one. Measured against the wrong sigma, the guard would cry
"corporate action" on correct prices four times a year per ticker.

And the multiplier suppresses false alarms, not detections: a 10:1 split on
the same night is still 44 sigma after it, and is still caught.
```

### TG3 — Wed 24, 14:00 WIB
**Media:** `card-calibration.png`

```
We got the calibration wrong the first time. Here is what happened.

The first fit estimated sigma from the spread of the data and scored 90.2%
coverage against a stated 95%.

That is not a tuning problem, and raising the multiplier would have been
the wrong fix. A 1.96x multiplier delivers 95% only if the distribution is
normal. Gap distributions are fat-tailed, so ANY moment-based estimate —
robust or classical — lands short by construction.

The fix was to stop estimating a moment and fit the quantity the claim is
actually about: the 95th percentile of the normalised gap.

Then a second problem. A band fitted to a quantile covers that quantile
in-sample by definition. Reporting that would be arithmetic wearing the
costume of evidence. So the fit runs on the first 60% of the history and is
scored on the last 40% — the only version of the number that can fail.

Out of sample: 97.0%.

The fit also corrected us. We had declared earnings multiples of 2.8–3.5x.
The worst decile only needs 1.43x. But a decile is 10% of the sample against
earnings' 1.6%, so most of it is ordinary volatile nights — which makes the
measured figure a LOWER bound. So a fit may raise an instrument's multiple
and never lower it, and there is a test pinning that.

Read as an upper bound it would narrow the band on exactly the nights the
guard exists for.
```

### TG4 — Wed 24, 21:30 WIB
**Media:** `card-board.png`

```
What the board looks like two hours before launch

Eight instruments, two independent feeds, refreshing live at tapeguard.xyz.

Right now every row reads REFUSED. Not because anything is broken —
because the US tape is shut, so every price on the board is a model output
that was never printed anywhere. provenance DERIVED, and the site says so
rather than serving you a number that looks live.

Watch what changes at 09:30 ET. Provenance flips to TRADED, the band
collapses from a few percent to single-digit basis points, and rows go green.

That transition is the whole product. Most feeds return the same-looking
number on both sides of it.

One detail worth pointing at: if a row shows SINGLE_SOURCE, it means one of
our two providers failed on that read and the feed is telling you it is
pricing on one source. It does not quietly report a cross-source spread of
zero and let you read that as agreement.
```

### TG5 — Wed 24, 23:05 WIB · LAUNCH
**Media:** `card-board.png`

```
tapeguard is live.

CA: [paste]
Pons V2: [paste link]

What shipped:

· Four guards — corporate actions, trading halts, earnings windows,
  feed independence
· A session calendar that computes Good Friday from Easter, and does not
  invent a holiday on 31 December when New Year falls on a Saturday
· Sigmas fitted against two years of realised gaps, scored out of sample
  at 97.0%, with the worst decile reported separately at 70.0%
· An EIP-712 contract whose reads refuse by default and whose reverts name
  the guard that stopped you
· A signer threshold that is a constructor parameter, so going to 2-of-3
  is a transaction rather than a redeploy that orphans every integrator
· 88 tests. Zero runtime dependencies in the guard engine. No build step.

What did not ship, stated plainly:

· The contracts are unaudited.
· The default price source is not licensed for commercial redistribution.
· The signer threshold ships at 1.
· There is no published on-chain track record yet. The backtest is evidence
  about the past, not evidence that what is running now is still right.

Site   tapeguard.xyz
Docs   tapeguard.xyz/docs
Code   github.com/tapeguard/tapeguard

Do not settle real money against this yet.
```

---

## Notes for posting

**Replace before posting:** every `[paste]` — the CA and the Pons link.

**Do not** add price talk, targets, or "next 100x" framing to any of this.
The only audience that can be won with these posts is people who will check
the claims, and the fastest way to lose them is one sentence that sounds
like every other launch.

**If a number changes** (re-running `npm run calibrate` will move them),
regenerate the cards — `python3 scripts/social.py` — and fix the copy. A
card that disagrees with the repo is worse than no card.

**The board card is live data.** Regenerate it right before CD3, TG4 and T9
so it shows the real state at posting time:

```bash
python3 scripts/board_card.py
```
