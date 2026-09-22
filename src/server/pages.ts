import { SITE, esc, layout } from "./layout.ts";
import { Flag, flagNames, hasFlag } from "../lib/flags.ts";
import type { Verdict } from "../lib/verdict.ts";
import { calibration, instruments, parameterSource } from "../lib/universe.ts";

const pct = (bps: number): string => (bps / 100).toFixed(2);

/**
 * States plainly whether the numbers on the page were fitted or assumed.
 *
 * Presenting a prior as fitted is not a rounding error; it is a false claim
 * about how much validation stands behind the number a liquidation reads.
 */
function parameterStatus(): string {
  const c = calibration();
  if (!c || parameterSource !== "fitted") {
    return `<p>
      Every sigma below is a <strong>prior, not a fitted value</strong>, and is labelled
      as one in the source. Run <code>npm run calibrate</code> before treating any band
      as validated.
    </p>`;
  }
  return `<p>
      Fitted against two years of realised close-to-open gaps on
      ${esc(c.fittedAt.slice(0, 10))}. The band is set from the
      <strong>95th percentile of the normalised gap</strong> rather than from a standard
      deviation: a 1.96&times; multiplier only delivers 95% coverage if the distribution
      is normal, and gap distributions are not &mdash; fitting from the standard
      deviation returned 90.2% against a stated 95%.
    </p>
    <p>
      Fitted on the first 60% of the history and scored on the last 40%. A band fitted
      to a quantile covers that quantile in-sample by construction, so an in-sample
      coverage figure is arithmetic rather than evidence.
    </p>
    <div class="grid c4" style="margin:26px 0">
      <div class="cell"><div class="n">${(c.pooledCoverage * 100).toFixed(1)}%</div>
        <div class="k">Out-of-sample coverage against a 95% claim.</div></div>
      <div class="cell"><div class="n">${(c.pooledWorstDecileCoverage * 100).toFixed(0)}%</div>
        <div class="k">Coverage on the worst decile &mdash; where earnings nights live.
        This is the number a headline hides.</div></div>
      <div class="cell"><div class="n">k = ${c.timeExponent.toFixed(3)}</div>
        <div class="k">Fitted time exponent. Square-root-of-time would be 0.500.</div></div>
      <div class="cell"><div class="n">${c.meanImpliedEarningsMultiple.toFixed(2)}&times;</div>
        <div class="k">What the worst decile needs. A lower bound: a decile is 10% of
        the sample and earnings are ~1.6% of it.</div></div>
    </div>`;
}

function stateTag(v: Verdict): string {
  if (v.safe) return `<span class="tag safe">SAFE</span>`;
  if (v.flags !== Flag.NONE) return `<span class="tag refuse">REFUSED</span>`;
  return `<span class="tag warn">REFUSED</span>`;
}

function boardRow(v: Verdict): string {
  const names = flagNames(v.flags);
  const flagCell = names.length
    ? `<span class="flags">${names.join(" · ")}</span>`
    : `<span class="flags none">none</span>`;
  const band = hasFlag(v.flags, Flag.DISCONTINUITY)
    ? `<span class="flags">no claim</span>`
    : `&plusmn;${pct(v.confidenceBps)}%`;
  return `<tr data-ticker="${esc(v.ticker)}">
  <td class="ticker">${esc(v.ticker)}</td>
  <td>${v.price.toFixed(2)}</td>
  <td>${band}</td>
  <td><span class="tag">${esc(v.provenanceName)}</span></td>
  <td>${flagCell}</td>
  <td>${esc(v.sessionName)}</td>
  <td>${v.sourceCount}</td>
  <td>${stateTag(v)}</td>
</tr>`;
}

function board(verdicts: readonly Verdict[]): string {
  if (verdicts.length === 0) {
    return `<p class="flags">The feed is not answering. That is reported, not hidden.</p>`;
  }
  return `<div class="board-scroll"><table class="board">
<thead><tr>
  <th>Instrument</th><th>Price</th><th>Band</th><th>Provenance</th>
  <th>Flags</th><th>Session</th><th>Src</th><th></th>
</tr></thead>
<tbody>${verdicts.map(boardRow).join("\n")}</tbody>
</table></div>`;
}

export function renderHome(verdicts: readonly Verdict[]): string {
  const safe = verdicts.filter((v) => v.safe).length;

  const body = `
<div class="hero-wrap">
  <canvas data-dither class="dither"></canvas>
  <div class="wrap hero">
    <h1>
      <span class="dimmed">Every oracle returns<br>a price.</span><br>
      None of them tell you<br>when it&rsquo;s a lie.
    </h1>
    <p class="lede">
      Tokenised equities trade around the clock. The shares behind them price for
      six and a half hours a day &mdash; and a price can be <strong>perfectly live,
      perfectly accurate, and about to become meaningless</strong>. A split. A halt.
      An earnings gap. tapeguard publishes the price together with the reason you
      should not act on it, and refuses by default when there is one.
    </p>
    <div class="cta-row">
      <a class="btn" href="#feed">See the feed</a>
      <a class="btn ghost" href="/docs">Integrate</a>
      <a class="btn ghost" href="${SITE.github}" rel="noopener">Read the code</a>
    </div>

    <div class="ca-block">
      <div class="label">Contract address</div>
      <div class="value"><span class="dot"></span>COMING SOON</div>
      <div class="note">${SITE.launchVenue} &middot; ${SITE.launch} &middot; ${SITE.chain} (${SITE.chainId})</div>
    </div>
  </div>
</div>

<section id="feed">
  <div class="wrap">
    <p class="eyebrow">Live feed</p>
    <h2>${safe} of ${verdicts.length} instruments are safe to read right now.</h2>
    <p>
      Every row carries where the number came from and why not to use it. The two
      are separate fields because they answer separate questions: a stock splitting
      tomorrow has a perfect live print today.
    </p>
    ${board(verdicts)}
    <div class="warn-bar">
      Evaluation build. Contracts unaudited, sigmas are documented priors pending
      calibration, and the default data source is not licensed for commercial
      redistribution. Do not settle real money against this yet.
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">What it catches</p>
    <h2>Four failures every equity oracle has, and none of them are on a calendar.</h2>
    <div class="grid c4" style="margin-top:32px">
      <div class="cell">
        <div class="n">153&sigma;</div>
        <div class="k">A 10:1 split is a 90% drop against a &plusmn;2.9% band. Detected with
        no corporate-actions feed at all &mdash; so it still works on the morning a
        vendor is down.</div>
      </div>
      <div class="cell">
        <div class="n">HALTED</div>
        <div class="k">Tape scheduled open, prints stopped. A halt is on no calendar,
        so a feed that trusts the clock hands a frozen price to a liquidation and
        labels it live.</div>
      </div>
      <div class="cell">
        <div class="n">8 / 500</div>
        <div class="k">Earnings gaps per ticker per two years. Miss every one and a
        model still reports 95% coverage &mdash; while failing on the nights a lender
        is most exposed.</div>
      </div>
      <div class="cell">
        <div class="n">2 feeds</div>
        <div class="k">Not two vendors. Three resellers of one IEX tape is one source
        wearing three hats, and their silence is one observation, not three.</div>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">The test that matters</p>
    <h2>A crash does not land on a clean fraction. A split always does.</h2>
    <p>
      The check is not &ldquo;is this move large&rdquo;. It is: the raw move is impossible as a
      price move, yet dividing it by exactly one clean split ratio leaves an
      ordinary overnight gap.
    </p>
    <div class="term"><span class="cm"># NVDA, Monday pre-market, anchored to Friday's close</span>
anchor   1800.00
price     180.00
move      <span class="hi">-90.00%</span>   =  <span class="no">126 sigma</span>   <span class="cm">not a price move</span>

<span class="cm"># divide out each candidate ratio and see what is left</span>
/ 0.1000  -&gt;   <span class="ok">0.0 sigma</span>   <span class="cm">an ordinary gap</span>
/ 0.5000  -&gt;    38 sigma   <span class="cm">rejected</span>
/ 0.7500  -&gt;    92 sigma   <span class="cm">rejected</span>

verdict   <span class="no">DISCONTINUITY | SPLIT_PENDING</span>
reason    10:1 forward split, not a repricing.
band      <span class="no">no claim</span>   <span class="cm"># every band from this anchor is meaningless</span></div>
    <p style="margin-top:22px">
      And the claim is bounded. A 4:3 split lands at 0.75 of the anchor &mdash; so does
      a 25% drop on a bad quarter. Price alone cannot separate those, so tapeguard
      <strong>refuses the price but does not claim the split</strong>, names the candidate,
      and defers to the corporate-actions feed. A guard that resolved that coin flip
      with a decimal point would be guessing.
    </p>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Integrating</p>
    <h2>Reads refuse by default, and the revert says which guard refused.</h2>
    <div class="term"><span class="cm">// the default: nothing but a clean live print gets through</span>
guard.getPriceIfSafe(<span class="hi">"NVDA"</span>, 600);
<span class="no">-&gt; revert Flagged("NVDA", flags: 3, disallowed: 3)</span>

<span class="cm">// opt into one risk, and the other still stops you</span>
guard.getPriceIfSafe(<span class="hi">"NVDA"</span>, 600, EARNINGS_WINDOW);
<span class="no">-&gt; revert Flagged(...)  </span><span class="cm">still held by SPLIT_PENDING</span>

<span class="cm">// opt into both, explicitly, having read what they mean</span>
guard.getPriceIfSafe(<span class="hi">"NVDA"</span>, 600, EARNINGS_WINDOW | SPLIT_PENDING);
<span class="ok">-&gt; 180.00000000</span></div>
    <p style="margin-top:22px">
      The revert carries the flags back, so a caller learns <em>which</em> guard stopped
      it rather than only that something did. The signer threshold is a constructor
      parameter, not a later upgrade: going to 2-of-3 is a transaction, not a
      redeploy, so integrators keep their address.
    </p>
    <div class="cta-row" style="margin-top:26px">
      <a class="btn" href="/docs">Read the docs</a>
      <a class="btn ghost" href="/api/verdicts">Raw JSON</a>
    </div>
  </div>
</section>`;

  return layout(
    {
      title: "Home",
      description:
        "A correctness layer for tokenised-equity price oracles. Publishes the price " +
        "with the reason not to use it: splits, halts, earnings windows and feed " +
        "independence. Refuses by default.",
      path: "/",
    },
    body,
    { dither: true },
  );
}

export function renderWhy(): string {
  const rows = instruments().map(
    (i) => `<tr>
  <td class="ticker">${i.ticker}</td>
  <td>${i.overnightSigmaBps}bps</td>
  <td>${i.haltThresholdSec}s</td>
  <td>${i.hasEarnings ? `&times;${i.earningsSigmaMultiple.toFixed(1)}` : "&mdash; ETF"}</td>
</tr>`,
  ).join("\n");

  const body = `
<section>
  <div class="wrap">
    <p class="eyebrow">Why</p>
    <h2>A third of every week has no price discovery, and a position can be liquidated in all of it.</h2>
    <p>
      ${SITE.chain} trades tokenised US equities around the clock with lending on top.
      The shares behind those tokens price for six and a half hours a day. Every
      oracle in production returns one number for both regimes.
    </p>
    <p>
      That is the problem the session-aware feeds already solve. This is the one they
      do not: <strong>a price can be live, correct, and still wrong to act on.</strong>
    </p>

    <h3 style="margin-top:40px">The split that liquidates everyone</h3>
    <p>
      NVIDIA splits 10:1. The price goes from $1,000 to $100 overnight. Nothing about
      the company changed and no holder lost a cent &mdash; but a feed publishing that
      number with a &plusmn;2.9% band has just told every lending protocol on the chain
      to liquidate every position at once. There is no file for this in any oracle
      shipping today.
    </p>

    <h3 style="margin-top:32px">The halt that is on no calendar</h3>
    <p>
      A session calendar knows holidays, DST and early closes. It does not know that
      trading in a name was paused four minutes ago. The tape is scheduled open, the
      label says REGULAR, and prints have stopped. The hard part is not noticing the
      silence &mdash; it is telling apart the exchange stopping from your vendor
      stopping, which is the same observation through one connection. That is why
      corroboration is counted in <em>feeds</em>, not vendors.
    </p>

    <h3 style="margin-top:32px">The earnings night the backtest cannot see</h3>
    <p>
      Gap distributions are bimodal: ordinary nights, and the four a year a company
      reports. Two years gives about eight earnings gaps per ticker against five
      hundred ordinary ones. A model can miss <strong>every single one</strong> and still
      report 95% coverage, because they are 1.6% of the sample &mdash; and they are
      exactly the nights a lender is most exposed. Headline coverage is structurally
      blind to it, so it has to be scored on its own.
    </p>

    <h3 style="margin-top:40px">Parameters</h3>
    ${parameterStatus()}
    <div class="board-scroll"><table class="board">
      <thead><tr><th>Instrument</th><th>Overnight &sigma;</th><th>Halt threshold</th><th>Earnings &sigma;</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>
</section>`;

  return layout(
    {
      title: "Why",
      description:
        "Why a live, accurate equity price can still be wrong to act on: corporate " +
        "actions, trading halts, earnings windows, and feed independence.",
      path: "/why",
    },
    body,
  );
}
