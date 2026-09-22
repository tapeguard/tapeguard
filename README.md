<div align="center">

<img src="./public/mark.svg" alt="tapeguard" width="64">

### tapeguard

**The price, and the reason not to use it.**

[Live feed](https://tapeguard.xyz) · [Why](https://tapeguard.xyz/why) · [Docs](https://tapeguard.xyz/docs) · [X](https://x.com/tapeguard) · [Telegram](https://t.me/tapeguard)

</div>

---

## What this is

A correctness layer for tokenised-equity price oracles on Robinhood Chain.

Session-aware feeds already solve one problem: a price from a shut tape is not
the same thing as a live print, and an oracle should say which it is. This
solves the one they do not.

**A price can be live, correct, and still wrong to act on.**

NVIDIA splits 10:1. The price goes from $1,000 to $100 overnight. Nothing about
the company changed and no holder lost a cent — but a feed publishing that
number with a ±2.9% band has just told every lending protocol on the chain to
liquidate every position at once. The provenance was `TRADED` the whole time.
It was true, and it was dangerous.

## Two fields, because there are two questions

Every oracle in production carries one enum. One enum cannot answer both of:

| | |
|---|---|
| `provenance` | where did this number come from? |
| `flags` | why should you not act on it right now? |

A stock splitting tomorrow morning has a perfect live print today. Forced into
one field, you must choose between saying `TRADED` — true, and dangerous — and
`STALE`, which is false, because the price is seconds old.

```
provenance  (pick one)
  0  TRADED     observed print, tape open, prints arriving
  1  DERIVED    model output, tape shut
  2  STALE      the data missed a session that already happened
  3  HALTED     tape scheduled OPEN and prints have stopped

flags  (a bitfield; several at once)
  1 << 0  SPLIT_PENDING      a corporate action makes this incomparable
  1 << 1  EARNINGS_WINDOW    a scheduled release sits inside the window
  1 << 2  DISCONTINUITY      the move is impossible as a price move
  1 << 3  SOURCE_DIVERGENT   sources disagree, or one vendor is lagging
  1 << 4  SINGLE_SOURCE      one source, or several vendors on one feed
  1 << 5  HALT_UNCONFIRMED   suspected, not corroborable
```

Reads refuse by default, and the revert says which guard refused:

```solidity
guard.getPriceIfSafe("NVDA", 600);
// revert Flagged("NVDA", flags: 3, disallowed: 3)

guard.getPriceIfSafe("NVDA", 600, EARNINGS_WINDOW);
// revert Flagged(...)            still held by SPLIT_PENDING

guard.getPriceIfSafe("NVDA", 600, EARNINGS_WINDOW | SPLIT_PENDING);
// 180.00000000                   explicit opt-in
```

## The guard that needs no feed

A corporate-actions vendor is precise when it is reachable. The interesting
case is the morning it is not.

The test is not *is this move large*. It is: **the raw move is impossible as a
price move, yet dividing it by exactly one clean split ratio leaves an ordinary
overnight gap.** A crash does not land on a clean fraction. A split always does.

```
anchor 1800.00 -> price 180.00     -90.00%  =  126 sigma

/ 0.1000  ->   0.0 sigma    an ordinary gap
/ 0.5000  ->  38   sigma    rejected
/ 0.7500  ->  92   sigma    rejected

DISCONTINUITY | SPLIT_PENDING     10:1 forward split, not a repricing
```

It tolerates a real move on top of the split, which is the normal case and the
one an exact-ratio match misses: a 10:1 that also rose 1% leaves 0.66 sigma of
residual and is still identified.

### And the claim is bounded

A 4:3 split takes the price to 0.75 of the anchor. So does a 25% drop on a bad
quarter. **From price alone those are the same observation**, and no threshold
separates them, because there is nothing there to separate.

So a split is claimed only when the ratio itself clears 25 sigma — when the
split would be an impossible price move. Below that bar the price is still
refused, the candidate is named so an operator knows where to look, and the
question is handed to the feed.

| ratio | sigma from no move | claimed |
|---|---|---|
| 10:1 → 0.100 | 153 | yes |
| 2:1 → 0.500 | 38 | yes |
| 3:2 → 0.667 | 22 | no |
| 4:3 → 0.750 | 16 | no |

This makes the two detectors complementary rather than redundant. The feedless
one claims only what it can prove; the feed resolves the ratios that are
indistinguishable from ordinary bad news.

## Feeds, not vendors

Three vendors agreeing on one IEX tape is one source wearing three hats. The
median cannot outvote a bad print they all inherited, and their cross-source
spread is zero for the same reason a single source's is: there is nothing there
to disagree.

So every provider declares the feed it resells, and independence is counted in
feeds. This changes two decisions:

- A halt is **corroborated** only across two genuinely different feeds.
  Otherwise the common silence is one observation, not three.
- `SINGLE_SOURCE` is raised when several vendors resolve to one feed, not only
  when one vendor answers.

`/api/health` reports `canCorroborateHalts`, so a one-feed deployment cannot
look like one that can.

## The earnings night a backtest cannot see

Gap distributions are bimodal: ordinary nights, and the four a year a company
reports. Two years gives roughly **eight earnings gaps per ticker against five
hundred ordinary ones**.

A model can miss *every single one* and still report 95% coverage, because they
are 1.6% of the sample — and they are exactly the nights a lender is most
exposed. Headline coverage is structurally blind to this, so it has to be
scored separately.

The earnings check runs **before** the discontinuity check, because it sets the
sigma that check measures against. NVDA reporting and opening 25% lower is a
real price the market made: 16 sigma of an ordinary night, 4.5 of an earnings
one. Measured against the ordinary sigma, the guard would cry corporate action
on correct prices four times a year per ticker.

The multiplier suppresses false alarms, not detections: a 10:1 split on the same
night is still 44 sigma after it, and is still caught.

## Layout

```
src/lib/                  the engine — zero dependencies
  session.ts              NYSE calendar: DST, holidays, early closes, Good Friday
  flags.ts                provenance and the flag bitfield (on-chain wire format)
  universe.ts             instruments and their parameters, labelled as priors
  consensus.ts            median across sources, and the real spread
  verdict.ts              assembles the guards in a deliberate order
  guards/halt.ts          tape open, prints stopped — attributed, not just noticed
  guards/corpaction.ts    the ratio test, and the scheduled feed
  guards/earnings.ts      bimodal gaps, and two honesty rules
src/providers/            Yahoo, Alpaca, Finnhub; each declares its feed
src/server/               API and site from one Node process, no framework
contracts/TapeGuard.sol   EIP-712 verification, M-of-N threshold, refusing reads
deploy/                   systemd units, nginx, provisioning
```

## Running it

No build step. Node 24+ runs the TypeScript directly.

```bash
npm install
npm test          # 47 engine tests
forge test        # 22 contract tests
npm run demo      # a verdict per scenario
npm run dev       # http://localhost:8080
```

`npm run demo` is part of the workflow, not a toy. It found a false positive
the unit tests missed — a unit test asserts what you thought to ask, a scenario
dump shows what the thing actually says.

## The relayer

`src/server/relayer.ts` builds verdicts, signs them and posts them. Verified
end to end against a local chain: eight verdicts, one transaction, 717,729
gas, read back and refused correctly by `getPriceIfSafe`.

```
posting 8/8: HOOD (never posted), COIN (never posted), NVDA (never posted), ...
  success 0xcd8b43d8... gas 717729

NVDA  22738000000  band 281  flags 16 (SINGLE_SOURCE)  DERIVED  PRE  1 source
getPriceIfSafe("NVDA", 600)  ->  revert NotLive("NVDA", 1)
```

Opting into a flag does not get past the provenance check, which is the point:
the tape was shut, so no price was safe regardless of which flags a caller was
willing to accept.

### What is worth posting

The materiality filter has one rule that matters: **a change of flags or
provenance always posts**, however little the price moved.

A filter keyed on price and band alone is exactly backwards for this product.
A stock halts, or goes ex-split tomorrow, and the number does not move at all
— so a price-only filter suppresses the update precisely when the feed has
something urgent to say, and the chain keeps serving a clean `TRADED` verdict
straight through the event the guards exist to catch.

```
RELAY_ONCE=true RELAY_DRY=true node src/server/relayer.ts
```

`RELAY_DRY` does everything except send, so a new deployment can be checked
before the first test of it is also an irreversible mainnet write.

## Deploying

```bash
sudo bash deploy/setup.sh                 # on the VPS
HOST=root@YOUR_IP bash deploy/push.sh     # from here
```

Two systemd units on purpose. The API holds no keys and faces the internet; the
relayer holds a funded key and faces the chain. A crash loop in one must not
take down the other, and the process exposed to the world should not be the one
holding a wallet.

A long-lived process rather than a scheduled function, because a host that
rejects a sub-daily cron schedule *at deploy time* leaves the last good build
serving a feed that has quietly stopped updating.

## Limits

Stated here rather than buried, because this list is what a consumer should
decide from.

- The contracts are **unaudited**.
- Every sigma is a documented **prior, not a fitted value**. Calibration against
  realised gaps has not run. Presenting a prior as fitted is not a rounding
  error; it is a false claim about how much validation stands behind the number
  a liquidation reads.
- The default price source is **not licensed for commercial redistribution**.
  Add a licensed vendor before production.
- A one-feed deployment **cannot corroborate a halt** and says so.
- The signer threshold ships at **1**. It is a parameter, not a redeploy — going
  to 2-of-3 is a transaction — but until it is raised the trust assumption is
  one key.
- Fractional splits are refused but not claimed. See above.

### Not built yet

- An earnings **provider**. The guard and its tests are done and
  `setEarnings()` accepts events, but nothing populates it yet, so
  `EARNINGS_WINDOW` never fires in production.
- `npm run calibrate` — fitting the sigmas against realised gaps.
- A published track record scored from chain logs.

**Do not settle real money against this.**

## Licence

ISC.
