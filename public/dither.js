/**
 * Dithered plasma background.
 *
 * A domain-warped fBm field, displaced by a decaying pointer trail, then
 * quantised to one bit through an 8x8 ordered (Bayer) dither. The dither is
 * what makes it read as a printed halftone rather than a gradient, which is
 * the only reason it sits correctly behind monospace type.
 *
 * No dependencies. Degrades to a flat background when WebGL is missing, and
 * holds a single static frame when the visitor asked for reduced motion.
 */
(() => {
  "use strict";

  const TRAIL = 24;

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;

    uniform vec2  uResolution;
    uniform float uTime;
    uniform vec3  uTrail[${TRAIL}];   // xy in aspect-corrected space, z = energy
    uniform float uCell;              // dither cell size, device pixels
    uniform float uThreshold;
    uniform float uReduced;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
        f.z);
    }

    float fbm(vec3 p) {
      float a = 0.5, s = 0.0;
      for (int i = 0; i < 6; i++) {
        s += a * noise(p);
        p *= 2.03;
        a *= 0.5;
      }
      return s;
    }

    /**
     * Twice-warped fBm. One warp only breathes in place; feeding the warped
     * field back through itself is what produces folding sheets that read as
     * smoke or ink rather than as noise.
     */
    float smoke(vec2 p, float t) {
      vec3 q  = vec3(p * 0.58, t * 0.045);
      vec2 w1 = vec2(fbm(q), fbm(q + vec3(3.7, 8.3, 1.1)));

      vec3 q2 = vec3(p * 0.66 + w1 * 1.9, t * 0.055);
      vec2 w2 = vec2(fbm(q2), fbm(q2 + vec3(1.7, 9.2, 2.3)));

      return fbm(vec3(p * 0.82 + w2 * 2.5, t * 0.07));
    }

    // Compact nested-2x2 construction of the Bayer threshold matrix.
    float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    void main() {
      vec2 frag = gl_FragCoord.xy;
      vec2 uv = frag / uResolution;
      float aspect = uResolution.x / max(uResolution.y, 1.0);

      // Stretched horizontally so the sheets drift sideways rather than
      // sitting as round blobs.
      vec2 p = vec2((uv.x - 0.5) * aspect * 0.80, uv.y - 0.5);

      float t = uTime * (uReduced > 0.5 ? 0.0 : 1.0);

      /*
       * Normalised by the slot count, not left as a raw sum.
       *
       * Energies decay by 0.94 per frame and a moving pointer keeps all
       * ${TRAIL} slots warm, so the unnormalised sum converges to
       * 1/(1-0.94) ~= 16.7 rather than to something near 1. Used directly it
       * displaced the noise lookup by sixteen field widths and saturated
       * every dither cell, which showed up as a solid untextured disc under
       * the cursor and a washed-out panel everywhere else.
       */
      float disp = 0.0;
      for (int i = 0; i < ${TRAIL}; i++) {
        vec3 s = uTrail[i];
        if (s.z <= 0.001) continue;
        float d = length(p - s.xy);
        disp += (s.z / float(${TRAIL})) * exp(-d * 8.5) * sin(d * 30.0 - t * 2.2);
      }
      disp = clamp(disp, -1.0, 1.0);

      float v = smoke(p + disp * 0.30, t);

      /*
       * Remap measured off the field, not guessed at.
       *
       * Sampling this twice-warped fBm over a 70x70 grid gives mean 0.526,
       * sd 0.106, and quartiles 0.475 / 0.569 / 0.602 with p95 at 0.635. The
       * visible range is therefore only about 0.16 wide and clustered tightly
       * above the midpoint, not spread across 0..1 as an unwarped fBm would
       * be. A gentle scale maps that whole range into 5-47% dither density,
       * which is a flat mid-grey with no contrast anywhere — the panel looked
       * washed out for want of gain, not for want of brightness.
       *
       * Solving for p50 -> 0.13 and p95 -> 0.62:
       *
       *   p25  0.475 -> 0.00   black ground
       *   p50  0.569 -> 0.13   faint grain
       *   p75  0.602 -> 0.38   a visible sheet
       *   p95  0.635 -> 0.62   a bright filament
       */
      v = (v - 0.551) * 7.4;
      v += abs(disp) * 0.30;
      v = clamp(v, 0.0, 1.0);

      // Even, gentle edge falloff. No directional scrim: the effect has to
      // cover the whole panel, which was the thing that read as wrong.
      v *= smoothstep(1.45, 0.30, length(p * vec2(0.88, 1.10)));

      float th = bayer8(frag / max(uCell, 1.0));
      float lit = step(th, v);

      gl_FragColor = vec4(mix(vec3(0.0), vec3(0.72), lit), 1.0);
    }
  `;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
    }
    return sh;
  }

  function start(canvas) {
    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      powerPreference: "low-power",
    });
    if (!gl) return false;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, "uResolution"),
      time: gl.getUniformLocation(prog, "uTime"),
      trail: gl.getUniformLocation(prog, "uTrail"),
      cell: gl.getUniformLocation(prog, "uCell"),
      threshold: gl.getUniformLocation(prog, "uThreshold"),
      reduced: gl.getUniformLocation(prog, "uReduced"),
    };

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const trail = new Float32Array(TRAIL * 3);
    let head = 0;
    let aspect = 1;

    function resize() {
      // Capped DPR: the dither is a per-pixel effect, so full retina buys
      // nothing visible and costs four times the fragments.
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (w === canvas.width && h === canvas.height) return;
      canvas.width = w;
      canvas.height = h;
      aspect = w / Math.max(h, 1);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(u.res, w, h);
      gl.uniform1f(u.cell, Math.max(2, Math.round(2 * dpr)));
    }

    function push(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width - 0.5) * aspect;
      const y = 0.5 - (clientY - r.top) / r.height;
      trail[head * 3] = x;
      trail[head * 3 + 1] = y;
      trail[head * 3 + 2] = 1.0;
      head = (head + 1) % TRAIL;
    }

    if (!reduced) {
      addEventListener("pointermove", (e) => push(e.clientX, e.clientY), { passive: true });
      addEventListener(
        "touchmove",
        (e) => {
          const t = e.touches[0];
          if (t) push(t.clientX, t.clientY);
        },
        { passive: true },
      );
    }

    gl.uniform1f(u.threshold, 0.0);
    gl.uniform1f(u.reduced, reduced ? 1 : 0);
    resize();
    addEventListener("resize", resize, { passive: true });

    let running = true;
    // A background must not burn a laptop battery in a hidden tab.
    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running) requestAnimationFrame(frame);
    });

    const t0 = performance.now();
    function frame(now) {
      if (!running) return;
      resize();
      for (let i = 0; i < TRAIL; i++) trail[i * 3 + 2] *= 0.94;
      gl.uniform3fv(u.trail, trail);
      gl.uniform1f(u.time, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return true;
  }

  function init() {
    const canvas = document.querySelector("[data-dither]");
    if (!canvas) return;
    try {
      if (!start(canvas)) canvas.style.display = "none";
    } catch {
      canvas.style.display = "none";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
