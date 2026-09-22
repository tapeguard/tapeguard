/**
 * Text scramble on reveal, and a live board refresh.
 *
 * The scramble decodes rather than fades because the product is about
 * resolving a number you cannot yet trust into one you can.
 */
(() => {
  "use strict";
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\|<>_-=+*%$#@";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function scramble(el) {
    const target = el.dataset.text || el.textContent || "";
    if (reduced) {
      el.textContent = target;
      el.classList.add("on");
      return;
    }
    el.classList.add("on");
    const start = performance.now();
    const dur = Math.min(120 + target.length * 22, 900);
    (function step(now) {
      const t = Math.min((now - start) / dur, 1);
      const settled = Math.floor(target.length * t);
      let out = target.slice(0, settled);
      for (let i = settled; i < target.length; i++) {
        out += target[i] === " " ? " " : CHARS[(Math.random() * CHARS.length) | 0];
      }
      el.textContent = out;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = target;
    })(start);
  }

  function observe() {
    const targets = document.querySelectorAll("[data-scramble]");
    if (targets.length === 0) return;
    for (const el of targets) {
      el.dataset.text = el.textContent || "";
      el.classList.add("scramble");
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          scramble(e.target);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.4 },
    );
    for (const el of targets) io.observe(el);
  }

  /**
   * Refresh the board in place. Only while the tab is visible: a background
   * tab polling a rate-limited upstream is how a public feed gets throttled.
   */
  function liveBoard() {
    const body = document.querySelector(".board tbody");
    if (!body) return;
    const PERIOD = 20_000;
    let timer = null;

    async function tick() {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/verdicts", { headers: { accept: "application/json" } });
        if (!res.ok && res.status !== 207) return;
        const data = await res.json();
        if (!Array.isArray(data.verdicts)) return;
        for (const v of data.verdicts) {
          const row = body.querySelector(`tr[data-ticker="${v.ticker}"]`);
          if (!row) continue;
          const cells = row.children;
          if (cells[1]) cells[1].textContent = Number(v.price).toFixed(2);
        }
      } catch {
        /* a failed refresh leaves the server-rendered board in place */
      }
    }

    function schedule() {
      clearInterval(timer);
      if (!document.hidden) timer = setInterval(tick, PERIOD);
    }
    document.addEventListener("visibilitychange", schedule);
    schedule();
  }

  function init() {
    observe();
    liveBoard();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
