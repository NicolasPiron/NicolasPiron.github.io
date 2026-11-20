/*
 * Simulated multichannel MEG recording, scrolling in time.
 * Each channel = slow 1/f-like drift + alpha bursts (~10 Hz) + sensor noise.
 * Every few seconds a stimulus is "presented" and an evoked response
 * (M100 / M170-like components) appears across channels with a
 * channel-specific amplitude and polarity, as in a real sensor array.
 */
(function () {
  "use strict";

  const FS = 250;            // samples per second
  const WINDOW_S = 5;        // seconds visible
  const N = FS * WINDOW_S;   // samples in buffer
  const N_CH = 10;
  const STIM_EVERY = [2.2, 3.4]; // s, jittered inter-stimulus interval

  function rand(a, b) { return a + Math.random() * (b - a); }
  function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function init(container) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const labels = [];
    const ch = [];
    for (let i = 0; i < N_CH; i++) {
      labels.push("MEG " + String(111 + i * 37).padStart(4, "0"));
      ch.push({
        buf: new Float32Array(N),
        drift: 0,
        drift2: 0,
        alphaW: Math.max(0, gauss() * 0.5 + (i > N_CH / 2 ? 0.9 : 0.4)),
        alphaPh: rand(0, 2 * Math.PI),
        alphaF: rand(9, 11),
        // evoked topography: signed weights for each component
        w1: gauss() * 1.1,
        w2: gauss() * 0.9,
        w3: gauss() * 0.4,
      });
    }

    let env = 0.5;               // shared alpha envelope
    let t = 0;                   // simulated time (s)
    let head = 0;                // ring buffer write index
    let nextStim = rand(0.8, 1.5);
    const stims = [];            // stimulus onset times (s)
    let acc = 0;

    function evoked(c, dt) {
      if (dt < 0 || dt > 0.8) return 0;
      const g = (mu, sd) => Math.exp(-0.5 * ((dt - mu) / sd) ** 2);
      return c.w1 * g(0.1, 0.018) - c.w2 * g(0.17, 0.03) + c.w3 * g(0.4, 0.09);
    }

    function step() {
      t += 1 / FS;
      if (t >= nextStim) {
        stims.push(nextStim);
        nextStim += rand(STIM_EVERY[0], STIM_EVERY[1]);
      }
      while (stims.length && t - stims[0] > WINDOW_S + 1) stims.shift();

      env += (rand(-1, 1) * 0.04) - (env - 0.5) * 0.004;
      env = Math.min(1.2, Math.max(0.05, env));

      for (const c of ch) {
        c.drift = 0.985 * c.drift + gauss() * 0.06;   // slow, brown-ish
        c.drift2 = 0.8 * c.drift2 + gauss() * 0.12;   // faster component
        const alpha = c.alphaW * env * 0.55 *
          Math.sin(2 * Math.PI * c.alphaF * t + c.alphaPh);
        let ev = 0;
        for (const s of stims) ev += evoked(c, t - s);
        c.buf[head] = c.drift * 0.7 + c.drift2 * 0.35 + alpha + ev +
          gauss() * 0.05;
      }
      head = (head + 1) % N;
    }

    // prefill so the window is not empty on load
    for (let i = 0; i < N; i++) step();

    let W = 0, H = 0, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = container.clientWidth;
      H = container.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    }

    let colors = {};
    function readColors() {
      const cs = getComputedStyle(container);
      colors = {
        line: cs.getPropertyValue("--trace-line").trim() || "#444",
        muted: cs.getPropertyValue("--trace-muted").trim() || "#999",
        accent: cs.getPropertyValue("--trace-accent").trim() || "#0b5fad",
        font: getComputedStyle(document.body).getPropertyValue("--pst-font-family-monospace").trim() || "monospace",
      };
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const labelW = W < 500 ? 0 : 64;
      const top = 6, bottom = 22;
      const plotW = W - labelW;
      const rowH = (H - top - bottom) / N_CH;
      const xs = plotW / (N - 1);
      const gain = rowH * 0.42;

      // stimulus markers
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([2, 3]);
      for (const s of stims) {
        const age = t - s;
        if (age < 0 || age > WINDOW_S) continue;
        const x = labelW + plotW - age * FS * xs;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, top);
        ctx.lineTo(Math.round(x) + 0.5, H - bottom + 4);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // traces
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.font = "10px " + colors.font;
      ctx.textBaseline = "middle";
      for (let i = 0; i < N_CH; i++) {
        const y0 = top + rowH * (i + 0.5);
        if (labelW) {
          ctx.fillStyle = colors.muted;
          ctx.fillText(labels[i], 0, y0);
        }
        const b = ch[i].buf;
        ctx.beginPath();
        for (let k = 0; k < N; k++) {
          const v = b[(head + k) % N];
          const x = labelW + k * xs;
          const y = y0 - v * gain;
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // time scale bar (500 ms)
      const barW = 0.5 * FS * xs;
      const bx = W - barW, by = H - 7;
      ctx.strokeStyle = colors.muted;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(W, by);
      ctx.moveTo(bx + 0.5, by - 3); ctx.lineTo(bx + 0.5, by + 3);
      ctx.moveTo(W - 0.5, by - 3); ctx.lineTo(W - 0.5, by + 3);
      ctx.stroke();
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "right";
      ctx.fillText("500 ms", bx - 6, by);
      ctx.textAlign = "left";
    }

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true, last = null, raf = null;

    function frame(now) {
      raf = null;
      if (last === null) last = now;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt * FS;
      while (acc >= 1) { step(); acc -= 1; }
      draw();
      schedule();
    }
    function schedule() {
      if (raf === null && visible && !document.hidden && !reduce.matches) {
        raf = requestAnimationFrame(frame);
      }
    }
    function restart() { last = null; schedule(); }

    resize(); readColors(); draw();
    new ResizeObserver(() => { resize(); draw(); }).observe(container);
    new MutationObserver(() => { readColors(); draw(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; restart(); })
      .observe(container);
    document.addEventListener("visibilitychange", restart);
    reduce.addEventListener("change", () => { restart(); draw(); });
    schedule();
  }

  function boot() {
    document.querySelectorAll(".meg-trace").forEach(init);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
