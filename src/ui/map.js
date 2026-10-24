// Moving map overlay (M): hill-shaded terrain, airports, navaids, route, aircraft.
import { h, button, num, pad3 } from './dom.js';
import { getTerrain } from '../world/terrain-height.js';
import { AIRPORTS, NAVAIDS, CITIES, LAKES, WORLD_HALF_SIZE, runwayGeometry } from '../world/world-data.js';
import { NM } from '../core/units.js';
import { DEG } from '../core/math.js';

const BASE_RES = 640;
const EXTENT = WORLD_HALF_SIZE; // metres from centre

export class MapOverlay {
  constructor(root, app) {
    this.app = app;
    this.visible = false;
    this.canvas = h('canvas.map-canvas');
    this.info = h('div.map-info');
    this.followBtn = button('⌖ Segui aereo', () => {
      this.follow = !this.follow;
      this.followBtn.classList.toggle('active', this.follow);
    }, 'small active');
    this.el = h(
      'div.map-overlay',
      h('div.map-frame', this.canvas, h('div.map-toolbar', h('b', 'Mappa'), this.followBtn, button('＋', () => this.zoomBy(1.4), 'small'), button('－', () => this.zoomBy(1 / 1.4), 'small'), button('✕', () => this.hide(), 'small ghost')), this.info, h('div.map-help', 'Rotella: zoom · Trascina: sposta · Clic su un aeroporto o radioassistenza: GPS "diretto a"')),
    );
    root.appendChild(this.el);
    this.scale = 0.012; // pixels per metre
    this.cn = 0;
    this.ce = 0;
    this.follow = true;
    this.base = null;
    this._building = false;
    this._bindEvents();
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this.el.classList.add('visible');
    if (!this.base && !this._building) this._buildBase();
    this._resize();
  }

  hide() {
    this.visible = false;
    this.el.classList.remove('visible');
  }

  zoomBy(f) {
    this.scale = Math.min(0.2, Math.max(0.0025, this.scale * f));
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(10, Math.round(r.width * dpr));
    this.canvas.height = Math.max(10, Math.round(r.height * dpr));
    this.dpr = dpr;
  }

  /** Hill-shaded base image built incrementally (a few rows per frame). */
  _buildBase() {
    this._building = true;
    const T = getTerrain();
    const N = BASE_RES;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    const step = (2 * EXTENT) / N;
    let row = 0;
    let prev = new Float32Array(N);
    let cur = new Float32Array(N);
    const work = () => {
      const t0 = performance.now();
      while (row < N && performance.now() - t0 < 12) {
        const n = EXTENT - (row + 0.5) * step;
        for (let x = 0; x < N; x++) {
          const e = -EXTENT + (x + 0.5) * step;
          const hgt = T.height(n, e);
          cur[x] = hgt;
          const hn = row > 0 ? prev[x] : hgt;
          const he = x > 0 ? cur[x - 1] : hgt;
          const lake = T.lakeLevel(n, e);
          let c;
          if (hgt <= 0) {
            const d = Math.min(1, -hgt / 120);
            c = [40 - d * 20, 92 - d * 40, 150 - d * 45];
          } else if (lake !== null && hgt < lake) c = [52, 110, 170];
          else {
            if (hgt < 3) c = [214, 205, 160];
            else if (hgt < 200) c = [116, 158, 92];
            else if (hgt < 500) c = [138, 160, 96];
            else if (hgt < 900) c = [150, 150, 100];
            else if (hgt < 1400) c = [150, 132, 104];
            else if (hgt < 1900) c = [156, 146, 136];
            else c = [236, 238, 242];
            if (T.cityFactor(n, e) > 0.15) c = [178, 168, 160];
            const shade = 1 + ((hn - hgt) * 0.6 + (he - hgt) * 0.6) / Math.max(step * 0.08, 1);
            const k = Math.max(0.55, Math.min(1.35, shade));
            c = [c[0] * k, c[1] * k, c[2] * k];
          }
          const i = (row * N + x) * 4;
          img.data[i] = c[0];
          img.data[i + 1] = c[1];
          img.data[i + 2] = c[2];
          img.data[i + 3] = 255;
        }
        const t = prev;
        prev = cur;
        cur = t;
        row++;
      }
      if (row < N) requestAnimationFrame(work);
      else {
        ctx.putImageData(img, 0, 0);
        this.base = cv;
        this._building = false;
      }
      if (row % 64 === 0 || row === N) {
        ctx.putImageData(img, 0, 0);
        this.partial = cv;
      }
    };
    requestAnimationFrame(work);
  }

  _bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const before = this._toWorld(e.offsetX, e.offsetY);
      this.zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
      const after = this._toWorld(e.offsetX, e.offsetY);
      this.cn += before.n - after.n;
      this.ce += before.e - after.e;
      this.follow = false;
      this.followBtn.classList.remove('active');
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      drag = { x: e.clientX, y: e.clientY, cn: this.cn, ce: this.ce, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) {
        this._hover = this._pick(e.offsetX, e.offsetY);
        c.style.cursor = this._hover ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved) {
        this.follow = false;
        this.followBtn.classList.remove('active');
        this.ce = drag.ce - dx / this.scale;
        this.cn = drag.cn + dy / this.scale;
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        const p = this._pick(e.offsetX, e.offsetY);
        if (p) this.app.flightSim.command('gpsDirect', { id: p.id, n: p.n, e: p.e });
      }
      drag = null;
    });
    window.addEventListener('resize', () => this.visible && this._resize());
  }

  _toWorld(x, y) {
    const r = this.canvas.getBoundingClientRect();
    return { e: this.ce + (x - r.width / 2) / this.scale, n: this.cn - (y - r.height / 2) / this.scale };
  }

  _toScreen(n, e) {
    const W = this.canvas.width / this.dpr,
      H = this.canvas.height / this.dpr;
    return [W / 2 + (e - this.ce) * this.scale, H / 2 - (n - this.cn) * this.scale];
  }

  _pick(x, y) {
    let best = null,
      bd = 14;
    for (const a of AIRPORTS) {
      const [sx, sy] = this._toScreen(a.n, a.e);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) {
        bd = d;
        best = { id: a.icao, n: a.n, e: a.e, label: a.name };
      }
    }
    for (const v of NAVAIDS) {
      const [sx, sy] = this._toScreen(v.n, v.e);
      const d = Math.hypot(sx - x, sy - y);
      if (d < bd) {
        bd = d;
        best = { id: v.id, n: v.n, e: v.e, label: v.name };
      }
    }
    return best;
  }

  update() {
    if (!this.visible) return;
    const sim = this.app.flightSim;
    const fm = sim.fm;
    if (!fm) return;
    if (this.follow) {
      this.cn = fm.pos.x;
      this.ce = fm.pos.y;
    }
    const ctx = this.canvas.getContext('2d');
    const dpr = this.dpr || 1;
    const W = this.canvas.width / dpr,
      H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1d3f66';
    ctx.fillRect(0, 0, W, H);
    const base = this.base || this.partial;
    if (base) {
      const [x0, y0] = this._toScreen(EXTENT, -EXTENT);
      const size = 2 * EXTENT * this.scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(base, x0, y0, size, size);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillText('Generazione mappa…', 20, 30);
    }
    // grid every 10 NM
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const g = 10 * NM;
    for (let v = -EXTENT; v <= EXTENT; v += g) {
      let [x] = this._toScreen(0, v);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      const [, y] = this._toScreen(v, 0);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // cities
    ctx.font = '600 11px system-ui, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    for (const c of CITIES) {
      const [x, y] = this._toScreen(c.n, c.e);
      ctx.fillStyle = 'rgba(40,30,30,0.75)';
      ctx.fillText(c.name, x, y + 4);
    }
    for (const lk of LAKES) {
      const [x, y] = this._toScreen(lk.n, lk.e);
      ctx.fillStyle = 'rgba(220,240,255,0.8)';
      ctx.font = 'italic 10px system-ui, sans-serif';
      ctx.fillText(lk.name, x, y);
    }
    // navaids
    for (const v of NAVAIDS) {
      const [x, y] = this._toScreen(v.n, v.e);
      ctx.save();
      ctx.translate(x, y);
      if (v.type === 'NDB') {
        ctx.fillStyle = '#b04ab8';
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(Math.cos(a) * 7, Math.sin(a) * 7, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#1b5fb0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
        }
        ctx.closePath();
        ctx.stroke();
        if (v.type === 'VORDME') ctx.strokeRect(-9, -9, 18, 18);
      }
      ctx.fillStyle = '#0d2a52';
      ctx.font = '600 10px Consolas, monospace';
      ctx.fillText(`${v.id} ${v.type === 'NDB' ? v.freq : v.freq.toFixed(2)}`, 0, 22);
      ctx.restore();
    }
    // airports
    for (const a of AIRPORTS) {
      for (const rw of a.runways) {
        const geo = runwayGeometry(a, rw);
        const [x1, y1] = this._toScreen(geo.ends[0].thrN, geo.ends[0].thrE);
        const [x2, y2] = this._toScreen(geo.ends[1].thrN, geo.ends[1].thrE);
        ctx.strokeStyle = rw.surface === 'grass' ? '#2f7a2f' : '#203040';
        ctx.lineWidth = Math.max(3, rw.width * this.scale);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      const [x, y] = this._toScreen(a.n, a.e);
      ctx.strokeStyle = '#1d4f91';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '700 12px system-ui, Segoe UI, sans-serif';
      ctx.fillStyle = '#0b2240';
      ctx.fillText(a.icao, x, y - 17);
      if (this.scale > 0.008) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(a.name, x, y + 26);
      }
    }
    // route
    const plan = sim.gps.plan;
    if (plan.length > 1) {
      ctx.strokeStyle = '#d43bd6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      plan.forEach((p, i) => {
        const [x, y] = this._toScreen(p.n, p.e);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    const cur = sim.gps.current;
    if (cur) {
      const [x1, y1] = this._toScreen(fm.pos.x, fm.pos.y);
      const [x2, y2] = this._toScreen(cur.n, cur.e);
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#ff4fe8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // mission markers
    const markers = this.app.runner?.getMarkers?.() || [];
    for (const m of markers) {
      const [x, y] = this._toScreen(m.n, m.e);
      ctx.fillStyle = m.done ? 'rgba(60,200,90,0.9)' : m.active ? '#ffd23f' : 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      if (m.type === 'ring') ctx.arc(x, y, 5, 0, Math.PI * 2);
      else {
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 7);
        ctx.lineTo(x - 6, y);
      }
      ctx.fill();
    }
    // aircraft
    const [ax, ay] = this._toScreen(fm.pos.x, fm.pos.y);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(fm.heading * DEG);
    ctx.fillStyle = '#ffcc00';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(3, -3);
    ctx.lineTo(12, 2);
    ctx.lineTo(3, 2);
    ctx.lineTo(2, 9);
    ctx.lineTo(6, 12);
    ctx.lineTo(-6, 12);
    ctx.lineTo(-2, 9);
    ctx.lineTo(-3, 2);
    ctx.lineTo(-12, 2);
    ctx.lineTo(-3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // heading line 2 minutes ahead
    const ahead = fm.gs * 120;
    const [hx, hy] = this._toScreen(fm.pos.x + Math.cos(fm.track * DEG) * ahead, fm.pos.y + Math.sin(fm.track * DEG) * ahead);
    ctx.strokeStyle = 'rgba(255,204,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    // hover label
    if (this._hover) {
      const [x, y] = this._toScreen(this._hover.n, this._hover.e);
      const txt = `${this._hover.label} — clic: diretto a`;
      ctx.font = '600 12px system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 14;
      ctx.fillStyle = 'rgba(10,20,35,0.85)';
      ctx.fillRect(x + 14, y - 26, w, 22);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(txt, x + 21, y - 11);
      ctx.textAlign = 'center';
    }
    // scale bar
    const nmPx = NM * this.scale;
    let sb = 1;
    for (const s of [1, 2, 5, 10, 20, 50]) if (s * nmPx < 160) sb = s;
    ctx.fillStyle = 'rgba(10,20,35,0.7)';
    ctx.fillRect(14, H - 34, sb * nmPx + 20, 22);
    ctx.fillStyle = '#fff';
    ctx.fillRect(24, H - 20, sb * nmPx, 3);
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${sb} NM`, 26, H - 24);
    // info
    const w = sim.fm.wind;
    const wspd = Math.hypot(w.x, w.y) / 0.514444;
    const wdir = (Math.atan2(-w.y, -w.x) / DEG + 360) % 360;
    const gpsTxt = cur ? ` · GPS ${cur.id}: ${num(sim.gps.dist / NM, 1)} NM per ${pad3(sim.gps.brg)}°` : '';
    this.info.textContent = `PRUA ${pad3(fm.heading)}° · GS ${Math.round(fm.gsKt)} kt · ALT ${Math.round(sim.instruments.alt)} ft · Vento ${pad3(wdir)}°/${Math.round(wspd)} kt${gpsTxt}`;
  }
}
