// A canvas scatter plot: linear or log axes, hover, click to select, drag to zoom, double-click to reset.
// Colours come from CSS custom properties on the figure, so light/dark follow the page.
import { hzLimits } from "./physics.js";
import { fmt } from "./fields.js";

const M = { l: 70, r: 14, t: 14, b: 44 };
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const tickText = (v, log) => {
  if (log && v > 0) { const e = Math.round(Math.log10(v)); if (Math.abs(e) >= 4 && Math.abs(v / 10 ** e - 1) < 1e-9) return "10" + String(e).replace(/./g, (ch) => SUP[ch]); }
  return fmt(v, 3);
};

export class Scatter {
  constructor(figure, { onSelect, onHover } = {}) {
    this.fig = figure;
    this.canvas = figure.querySelector("canvas");
    this.tip = figure.querySelector(".plot-tip");
    this.ctx = this.canvas.getContext("2d");
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.zoom = null;           // {x:[a,b], y:[a,b]} in data units, or null for auto
    this.drag = null;
    this.hover = null;
    this.state = null;
    new ResizeObserver(() => this.draw()).observe(this.fig);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.draw());
    this.bind();
  }

  set(state) {
    const axesChanged = !this.state || state.x !== this.state.x || state.y !== this.state.y || state.xLog !== this.state.xLog || state.yLog !== this.state.yLog;
    if (axesChanged) this.zoom = null;
    this.state = state;
    this.draw();
  }

  resetZoom() { this.zoom = null; this.draw(); }

  // ---------- scales ----------
  // Auto range: all points when few, else the 0.5–99.5 percentile so a handful of outliers do not squash the rest.
  extent(key, log, hint) {
    const s = this.state;
    const vals = [];
    for (const p of s.points.length ? s.points : s.context) { const v = p[key]; if (v != null && Number.isFinite(v) && !(log && v <= 0)) vals.push(v); }
    if (s.solar && !hint) for (const p of s.solar) { const v = p[key]; if (v != null && Number.isFinite(v) && !(log && v <= 0)) vals.push(v); }
    if (hint) return hint;
    if (!vals.length) return log ? [0.1, 10] : [0, 1];
    vals.sort((a, b) => a - b);
    const q = (f) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(f * (vals.length - 1))))];
    let [lo, hi] = vals.length > 200 ? [q(0.005), q(0.995)] : [vals[0], vals[vals.length - 1]];
    if (lo === hi) { if (log) { lo /= 2; hi *= 2; } else { lo -= 1; hi += 1; } }
    if (log) { const k = (Math.log10(hi) - Math.log10(lo)) * 0.04; return [lo / 10 ** k, hi * 10 ** k]; }
    const pad = (hi - lo) * 0.04;
    return [lo - pad, hi + pad];
  }

  scale(domain, range, log) {
    const [d0, d1] = log ? domain.map(Math.log10) : domain;
    const [r0, r1] = range;
    const f = (v) => { if (v == null || !Number.isFinite(v) || (log && v <= 0)) return NaN; const t = ((log ? Math.log10(v) : v) - d0) / (d1 - d0); return r0 + t * (r1 - r0); };
    f.invert = (px) => { const t = (px - r0) / (r1 - r0); const v = d0 + t * (d1 - d0); return log ? 10 ** v : v; };
    f.domain = domain; f.log = log;
    return f;
  }

  ticks(sc) {
    const [a, b] = sc.domain;
    if (sc.log) {
      const lo = Math.floor(Math.log10(a)), hi = Math.ceil(Math.log10(b));
      const out = [];
      const decades = hi - lo;
      const mult = decades <= 2 ? [1, 2, 5] : decades <= 5 ? [1, 3] : [1];
      const step = decades > 12 ? 2 : 1;
      for (let e = lo; e <= hi; e += step) for (const m of mult) { const v = m * 10 ** e; if (v >= a && v <= b) out.push(v); }
      return out;
    }
    const span = b - a, raw = span / 6, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 7);
    const out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  // ---------- drawing ----------
  css(name) { return getComputedStyle(this.fig).getPropertyValue(name).trim(); }

  draw() {
    if (!this.state || !this.fig.offsetParent) return;
    const s = this.state;
    const dpr = window.devicePixelRatio || 1;
    const w = this.fig.clientWidth, h = Math.max(300, Math.min(560, Math.round(w * 0.62)));
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    const c = this.ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    this.w = w; this.h = h;

    const xd = this.zoom?.x ?? this.extent(s.x, s.xLog, s.xHint);
    const yd = this.zoom?.y ?? this.extent(s.y, s.yLog, s.yHint);
    const X = (this.X = this.scale(xd, [M.l, w - M.r], s.xLog));
    const Y = (this.Y = this.scale(yd, [h - M.b, M.t], s.yLog));

    const ink = this.css("--text"), muted = this.css("--muted"), grid = this.css("--plot-grid"), axis = this.css("--plot-axis");
    const mono = getComputedStyle(this.fig).getPropertyValue("--font-mono") || "monospace";

    // grid and ticks
    c.font = `11px ${mono}`;
    c.lineWidth = 1;
    c.fillStyle = muted;
    c.strokeStyle = grid;
    c.textAlign = "center"; c.textBaseline = "top";
    for (const v of this.ticks(X)) { const px = Math.round(X(v)) + 0.5; c.beginPath(); c.moveTo(px, M.t); c.lineTo(px, h - M.b); c.stroke(); c.fillText(tickText(v, X.log), px, h - M.b + 6); }
    c.textAlign = "right"; c.textBaseline = "middle";
    for (const v of this.ticks(Y)) { const py = Math.round(Y(v)) + 0.5; c.beginPath(); c.moveTo(M.l, py); c.lineTo(w - M.r, py); c.stroke(); c.fillText(tickText(v, Y.log), M.l - 6, py); }
    c.strokeStyle = axis;
    c.beginPath(); c.moveTo(M.l, M.t); c.lineTo(M.l, h - M.b + 0.5); c.lineTo(w - M.r, h - M.b + 0.5); c.stroke();

    // axis titles
    c.fillStyle = muted; c.font = `12px ${mono}`;
    c.textAlign = "right"; c.textBaseline = "bottom";
    c.fillText(s.xLabel + (s.xLog ? " · log" : ""), w - M.r, h - 4);
    c.save(); c.translate(4, M.t); c.rotate(-Math.PI / 2); c.textAlign = "right"; c.textBaseline = "top";
    c.fillText(s.yLabel + (s.yLog ? " · log" : ""), 0, 0); c.restore();

    c.save();
    c.beginPath(); c.rect(M.l, M.t, w - M.l - M.r, h - M.t - M.b); c.clip();

    if (s.x === "insol" && s.y === "st_teff") this.drawHZ(c, X, Y);

    // context: everything not matching the filters, faint
    if (s.showContext) {
      c.fillStyle = this.css("--plot-context");
      for (const p of s.context) { const px = X(p[s.x]), py = Y(p[s.y]); if (px === px && py === py) c.fillRect(px - 1.5, py - 1.5, 3, 3); }
    }

    // matched points, drawn in colour order so highlighted groups end up on top
    const r = s.points.length > 2000 ? 2.6 : s.points.length > 300 ? 3.4 : 4.4;
    const surface = this.css("--scope");
    const byColor = new Map();
    for (const p of s.points) { const col = s.color(p); if (!byColor.has(col.z)) byColor.set(col.z, []); byColor.get(col.z).push([p, col.c]); }
    for (const z of [...byColor.keys()].sort((a, b) => a - b)) {
      for (const [p, col] of byColor.get(z)) {
        const px = X(p[s.x]), py = Y(p[s.y]);
        if (px !== px || py !== py) continue;
        c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2);
        c.fillStyle = col; c.fill();
        c.lineWidth = 1; c.strokeStyle = surface; c.stroke();
      }
    }

    // labels skip any spot already taken, so dense clusters stay readable
    const taken = [];
    const label = (text, x, y, font, align = "left", base = "middle") => {
      c.font = font;
      const wd = c.measureText(text).width, ht = 13;
      const x0 = align === "left" ? x : x - wd, y0 = base === "middle" ? y - ht / 2 : y - ht;
      if (taken.some((r) => x0 < r[2] && x0 + wd > r[0] && y0 < r[3] && y0 + ht > r[1])) return;
      taken.push([x0, y0, x0 + wd, y0 + ht]);
      c.textAlign = align; c.textBaseline = base; c.fillText(text, x, y);
    };

    // pinned and selected
    for (const p of s.points.concat(s.context)) {
      const pinned = s.pins.has(p.name), sel = p.name === s.selected;
      if (!pinned && !sel) continue;
      const px = X(p[s.x]), py = Y(p[s.y]);
      if (px !== px || py !== py) continue;
      c.beginPath(); c.arc(px, py, sel ? 9 : 7, 0, Math.PI * 2);
      c.lineWidth = 2; c.strokeStyle = sel ? ink : this.css("--signal"); c.stroke();
      c.fillStyle = ink;
      label(p.name, px + 12, py, `600 12px ${mono}`);
    }

    // Solar System
    if (s.solar) {
      const order = [...s.solar].sort((a, b) => (a.name === "Earth" ? -1 : b.name === "Earth" ? 1 : 0));
      for (const p of order) {
        const px = X(p[s.x]), py = Y(p[s.y]);
        if (px !== px || py !== py) continue;
        c.beginPath(); c.arc(px, py, 5, 0, Math.PI * 2);
        c.fillStyle = surface; c.fill(); c.lineWidth = 2; c.strokeStyle = ink; c.stroke();
        c.beginPath(); c.arc(px, py, 1.6, 0, Math.PI * 2); c.fillStyle = ink; c.fill();
        c.fillStyle = ink;
        label(p.name, px + 7, py - 3, `11px ${mono}`, "left", "bottom");
      }
    }

    // hover ring
    if (this.hover) {
      const px = X(this.hover[s.x]), py = Y(this.hover[s.y]);
      c.beginPath(); c.arc(px, py, 7, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = ink; c.stroke();
    }

    // zoom rectangle
    if (this.drag?.moved) {
      const { x0, y0, x1, y1 } = this.drag;
      c.fillStyle = this.css("--beam-soft"); c.strokeStyle = this.css("--beam"); c.lineWidth = 1;
      c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      c.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    c.restore();
  }

  // Kopparapu limits as curves in the classic insolation vs star temperature plane.
  drawHZ(c, X, Y) {
    const T = [];
    for (let t = 2600; t <= 7200; t += 50) T.push(t);
    const lim = T.map((t) => [t, hzLimits(t)]);
    const band = (inner, outer, fill) => {
      c.beginPath();
      lim.forEach(([t, L], i) => (i ? c.lineTo : c.moveTo).call(c, X(L[inner]), Y(t)));
      for (let i = lim.length - 1; i >= 0; i--) c.lineTo(X(lim[i][1][outer]), Y(lim[i][0]));
      c.closePath(); c.fillStyle = fill; c.fill();
    };
    band("recentVenus", "earlyMars", this.css("--hz-opt"));
    band("runaway", "maxGreenhouse", this.css("--hz-cons"));
    c.setLineDash([4, 4]); c.lineWidth = 1; c.strokeStyle = this.css("--hz-line");
    for (const k of ["recentVenus", "runaway", "maxGreenhouse", "earlyMars"]) {
      c.beginPath(); lim.forEach(([t, L], i) => (i ? c.lineTo : c.moveTo).call(c, X(L[k]), Y(t))); c.stroke();
    }
    c.setLineDash([]);
  }

  // ---------- interaction ----------
  nearest(mx, my) {
    const s = this.state, X = this.X, Y = this.Y;
    let best = null, bd = 12 * 12;
    const scan = (list) => { for (const p of list) { const dx = X(p[s.x]) - mx, dy = Y(p[s.y]) - my; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } } };
    scan(s.points);
    if (s.solar) scan(s.solar);
    return best;
  }

  pos(ev) { const r = this.canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }

  showTip(p, mx, my) {
    const s = this.state;
    if (!p) { this.tip.hidden = true; return; }
    const est = (k) => (p.est?.has(k) ? "~" : "");
    this.tip.innerHTML = `<strong>${p.name}</strong>` +
      `<span>${s.xLabel}: ${est(s.x)}${fmt(p[s.x], 3)}</span>` +
      `<span>${s.yLabel}: ${est(s.y)}${fmt(p[s.y], 3)}</span>` +
      (p.ly != null && s.x !== "ly" && s.y !== "ly" ? `<span>${fmt(p.ly, 3)} ly away</span>` : "");
    this.tip.hidden = false;
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    let left = mx + 14, top = my - th - 10;
    if (left + tw > this.w - 4) left = mx - tw - 14;
    if (top < 4) top = my + 14;
    this.tip.style.transform = `translate(${left}px, ${top}px)`;
  }

  bind() {
    const cv = this.canvas;
    cv.addEventListener("pointerdown", (ev) => {
      const [x, y] = this.pos(ev);
      this.drag = { x0: x, y0: y, x1: x, y1: y, moved: false };
      cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener("pointermove", (ev) => {
      if (!this.state) return;
      const [x, y] = this.pos(ev);
      if (this.drag) {
        this.drag.x1 = x; this.drag.y1 = y;
        if (Math.abs(x - this.drag.x0) + Math.abs(y - this.drag.y0) > 6) this.drag.moved = true;
        if (this.drag.moved) { this.tip.hidden = true; this.draw(); return; }
      }
      const p = this.nearest(x, y);
      if (p !== this.hover) { this.hover = p; this.draw(); }
      this.showTip(p, x, y);
      cv.style.cursor = p ? "pointer" : "crosshair";
    });
    cv.addEventListener("pointerleave", () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    cv.addEventListener("pointerup", (ev) => {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (d.moved && Math.abs(d.x1 - d.x0) > 8 && Math.abs(d.y1 - d.y0) > 8) {
        const xs = [this.X.invert(d.x0), this.X.invert(d.x1)].sort((a, b) => a - b);
        const ys = [this.Y.invert(d.y0), this.Y.invert(d.y1)].sort((a, b) => a - b);
        this.zoom = { x: xs, y: ys };
        this.fig.dispatchEvent(new CustomEvent("zoomchange", { detail: true }));
        this.draw();
        return;
      }
      const [x, y] = this.pos(ev);
      const p = this.nearest(x, y);
      if (p && this.onSelect) this.onSelect(p);
      this.draw();
    });
    cv.addEventListener("dblclick", () => { this.zoom = null; this.fig.dispatchEvent(new CustomEvent("zoomchange", { detail: false })); this.draw(); });
  }
}
