import { SITE, layout } from "./layout.ts";
import { Flag, Provenance } from "../lib/flags.ts";

const PROVENANCE_DOC: Array<[number, string, string]> = [
  [Provenance.TRADED, "TRADED", "An observed print. The tape is scheduled open and prints are arriving."],
  [Provenance.DERIVED, "DERIVED", "A model output. The tape is shut and this price was never printed anywhere."],
  [Provenance.STALE, "STALE", "The data is behind a session that has already happened. Not merely old."],
  [Provenance.HALTED, "HALTED", "The tape is scheduled OPEN and prints have stopped arriving."],
];

const FLAG_DOC: Array<[number, string, string]> = [
  [Flag.SPLIT_PENDING, "SPLIT_PENDING", "A corporate action makes this price incomparable to the next one. Raised before the ex-date as well as after it."],
  [Flag.EARNINGS_WINDOW, "EARNINGS_WINDOW", "A scheduled release falls inside the window being priced, so the gap sigma is multiplied."],
  [Flag.DISCONTINUITY, "DISCONTINUITY", "The move is statistically impossible as a price move. The band is reported as no claim."],
  [Flag.SOURCE_DIVERGENT, "SOURCE_DIVERGENT", "Sources disagree beyond tolerance, or one vendor is lagging the others."],
  [Flag.SINGLE_SOURCE, "SINGLE_SOURCE", "One source resolved, or several vendors resolved to one underlying feed."],
  [Flag.HALT_UNCONFIRMED, "HALT_UNCONFIRMED", "A halt was suspected but could not be corroborated on a second independent feed."],
];

export function renderDocs(): string {
  const prov = PROVENANCE_DOC.map(
    ([n, name, desc]) =>
      `<tr><td>${n}</td><td class="ticker">${name}</td><td style="white-space:normal">${desc}</td></tr>`,
  ).join("\n");

  const flags = FLAG_DOC.map(
    ([bit, name, desc]) =>
      `<tr><td>1 &lt;&lt; ${Math.log2(bit)}</td><td>${bit}</td><td class="ticker">${name}</td><td style="white-space:normal">${desc}</td></tr>`,
  ).join("\n");

  const body = `
<section>
  <div class="wrap">
    <p class="eyebrow">Docs</p>
    <h2>Two fields, because they answer two questions.</h2>
    <p>
      <code>provenance</code> says where the number came from. <code>flags</code> says why not
      to act on it. A single enum cannot hold both: a stock splitting tomorrow has a
      perfect live print today, so the provenance is genuinely <code>TRADED</code> and the
      number becomes incomparable in sixteen hours. Forcing one field means choosing
      between a true, dangerous answer and a false one.
    </p>

    <h3 style="margin-top:40px">provenance</h3>
    <div class="board-scroll"><table class="board">
      <thead><tr><th>Value</th><th>Name</th><th>Meaning</th></tr></thead>
      <tbody>${prov}</tbody>
    </table></div>

    <h3 style="margin-top:40px">flags</h3>
    <p>A bitfield. Several can be raised at once. Values are the on-chain wire format:
    never renumbered, append only.</p>
    <div class="board-scroll"><table class="board">
      <thead><tr><th>Bit</th><th>Value</th><th>Name</th><th>Meaning</th></tr></thead>
      <tbody>${flags}</tbody>
    </table></div>

    <h3 style="margin-top:44px">Reading on chain</h3>
    <div class="term">interface ITapeGuard {
  <span class="cm">// Refuses unless the price is a live print with no flag raised.</span>
  function getPriceIfSafe(string calldata ticker, uint64 maxAge)
    external view returns (uint128);

  <span class="cm">// Same, but the caller opts into risks it has decided it understands.</span>
  function getPriceIfSafe(string calldata ticker, uint64 maxAge, uint16 allowedFlags)
    external view returns (uint128);

  <span class="cm">// The band edges, integer arithmetic, matching the off-chain computation.</span>
  function getBandedPrice(string calldata ticker)
    external view returns (uint128 lo, uint128 hi);

  <span class="cm">// Batch staleness discovery. view, so asking costs nothing.</span>
  function needsUpdate(string[] calldata tickers, uint64 maxAge)
    external view returns (bool[] memory);
}

<span class="cm">// The revert names the offenders, so a caller learns which guard stopped it.</span>
error Flagged(string ticker, uint16 flags, uint16 disallowed);
error NotLive(string ticker, uint8 provenance);
error TooOld(string ticker, uint64 age, uint64 maxAge);
error NotPosted(string ticker);</div>

    <h3 style="margin-top:44px">A liquidation path</h3>
    <p>
      The default read is the right one for anything that moves value. Do not widen
      the mask to make a revert go away &mdash; the revert is the product.
    </p>
    <div class="term"><span class="cm">// Correct: a liquidation accepts only a clean live print.</span>
uint128 price = guard.getPriceIfSafe("NVDA", 60);

<span class="cm">// Defensible: a UI may show a weekend estimate, clearly labelled,</span>
<span class="cm">// because nothing is settled against it.</span>
ITapeGuard.Verdict memory v = guard.getVerdict("NVDA");
render(v.price, v.confidenceBps, v.provenance, v.flags);

<span class="no">// Wrong: this re-creates the failure the contract exists to prevent.</span>
<span class="no">uint128 p = guard.getVerdict("NVDA").price;  // flags ignored</span></div>

    <h3 style="margin-top:44px">HTTP</h3>
    <div class="board-scroll"><table class="board">
      <thead><tr><th>Endpoint</th><th>Returns</th></tr></thead>
      <tbody>
        <tr><td class="ticker">GET /api/verdicts</td><td style="white-space:normal">Every instrument. <code>207</code> when some failed, so a partial board is not read as a complete one.</td></tr>
        <tr><td class="ticker">GET /api/quote/:ticker</td><td style="white-space:normal">One verdict, with its full reasoning chain.</td></tr>
        <tr><td class="ticker">GET /api/health</td><td style="white-space:normal">Session, providers, and <code>canCorroborateHalts</code> &mdash; whether this deployment has two independent feeds.</td></tr>
      </tbody>
    </table></div>

    <h3 style="margin-top:44px">Limits</h3>
    <p>
      Stated here rather than buried, because a consumer decides what to trust from
      this list and not from the headline.
    </p>
    <ul style="color:var(--muted);max-width:70ch;line-height:1.8">
      <li>The contracts are <strong>unaudited</strong>.</li>
      <li>Every sigma is a documented <strong>prior, not a fitted value</strong>. Calibration against realised gaps has not yet run.</li>
      <li>The default price source is <strong>not licensed for commercial redistribution</strong>. Add a licensed vendor before production.</li>
      <li>A deployment with one feed <strong>cannot corroborate a halt</strong> and says so in <code>/api/health</code>.</li>
      <li>The signer threshold ships at 1. It is a parameter, not a redeploy &mdash; but until it is raised, the trust assumption is one key.</li>
      <li>Fractional splits (3:2, 4:3, 5:4) are <strong>refused but not claimed</strong>: from price alone they are indistinguishable from a bad quarter.</li>
    </ul>

    <div class="cta-row" style="margin-top:32px">
      <a class="btn" href="${SITE.github}" rel="noopener">Read the source</a>
      <a class="btn ghost" href="/api/verdicts">Raw JSON</a>
    </div>
  </div>
</section>`;

  return layout(
    {
      title: "Docs",
      description:
        "Field semantics, the Solidity read interface, consumer policy examples and " +
        "the stated limits of the tapeguard feed.",
      path: "/docs",
    },
    body,
  );
}
