// Canvas drawings of the panel instruments: a classic "six-pack" with engine and radio
// column for light aircraft, and PFD / navigation display / engine page for glass cockpits.
// Every function draws in CSS pixels; the caller sets the device-pixel-ratio transform.
import { clamp } from '../core/math.js';

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const FONT = "system-ui, 'Segoe UI', Roboto, sans-serif";
const MONO = "'Consolas', 'SFMono-Regular', ui-monospace, monospace";
const wrap360 = (v) => ((v % 360) + 360) % 360;

export function text(c, value, x, y, size, color = '#e8eef0', align = 'center', weight = 600, font = FONT) {
  c.font = `${weight} ${size}px ${font}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillText(value, x, y);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Bezel, black face and a faint glass reflection. */
function face(c, x, y, r) {
  const ring = c.createLinearGradient(x - r, y - r, x + r, y + r);
  ring.addColorStop(0, '#6b777e');
  ring.addColorStop(0.5, '#2a3338');
  ring.addColorStop(1, '#11171b');
  c.fillStyle = ring;
  c.beginPath(); c.arc(x, y, r * 1.08, 0, TAU); c.fill();
  c.fillStyle = '#07090b';
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

function glare(c, x, y, r) {
  const g = c.createLinearGradient(x - r, y - r, x + r * 0.3, y + r * 0.3);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

function tick(c, x, y, a, r1, r2, width = 1, color = '#e9eef0') {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  c.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
  c.stroke();
}

function needle(c, x, y, a, length, width, color = '#f4f4ee', tail = 0.18) {
  c.save();
  c.translate(x, y);
  c.rotate(a);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(-length * tail, -width * 0.6);
  c.lineTo(length * 0.82, -width * 0.5);
  c.lineTo(length, 0);
  c.lineTo(length * 0.82, width * 0.5);
  c.lineTo(-length * tail, width * 0.6);
  c.closePath();
  c.fill();
  c.restore();
}

function hub(c, x, y, r) {
  c.fillStyle = '#3a4248';
  c.beginPath(); c.arc(x, y, Math.max(3, r * 0.07), 0, TAU); c.fill();
}

function arc(c, x, y, r, a0, a1, width, color) {
  if (a1 <= a0) return;
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.arc(x, y, r, a0, a1);
  c.stroke();
}

/** Airspeed indicator with white (flaps), green, yellow arcs and the red never-exceed line. */
export function airspeed(c, x, y, r, ias, { vs0 = 40, vs1 = 48, vfe = 85, vno = 129, vne = 163, max = 200 } = {}) {
  face(c, x, y, r);
  const sweep = TAU * 0.88;
  const ang = (v) => -Math.PI / 2 + clamp(v / max, 0, 1) * sweep;
  arc(c, x, y, r * 0.8, ang(vs0), ang(vfe), r * 0.06, '#f2f2f2');
  arc(c, x, y, r * 0.88, ang(vs1), ang(vno), r * 0.07, '#33b24a');
  arc(c, x, y, r * 0.88, ang(vno), ang(vne), r * 0.07, '#e6c419');
  tick(c, x, y, ang(vne), r * 0.78, r * 0.96, Math.max(2, r * 0.04), '#e0352b');
  const labelEvery = r > 60 ? 20 : 40;
  for (let v = 0; v <= max; v += 10) {
    const major = v % 20 === 0;
    tick(c, x, y, ang(v), r * (major ? 0.8 : 0.86), r * 0.96, major ? 1.6 : 1);
    if (v > 0 && v % labelEvery === 0) {
      const a = ang(v);
      text(c, String(v), x + Math.cos(a) * r * 0.63, y + Math.sin(a) * r * 0.63, Math.max(8, r * 0.17));
    }
  }
  text(c, 'AIRSPEED', x, y + r * 0.3, Math.max(6, r * 0.1), '#b8c4ca', 'center', 600);
  text(c, 'KNOTS', x, y + r * 0.44, Math.max(6, r * 0.09), '#8a979e', 'center', 500);
  needle(c, x, y, ang(ias), r * 0.86, Math.max(3, r * 0.07));
  hub(c, x, y, r);
  glare(c, x, y, r);
}

/** Artificial horizon with pitch ladder, bank scale and the flight director bars. */
export function attitude(c, x, y, w, h, pitch, roll, { round = true, fd = null } = {}) {
  c.save();
  c.translate(x, y);
  c.beginPath();
  if (round) c.arc(0, 0, w / 2, 0, TAU); else c.rect(-w / 2, -h / 2, w, h);
  c.clip();
  const pxPerDeg = h / 50;
  c.save();
  c.rotate(-roll * RAD);
  c.translate(0, pitch * pxPerDeg);
  const sky = c.createLinearGradient(0, -h, 0, 0);
  sky.addColorStop(0, '#1b5f9e');
  sky.addColorStop(1, '#4aa3e0');
  c.fillStyle = sky;
  c.fillRect(-w * 2, -h * 3, w * 4, h * 3);
  const ground = c.createLinearGradient(0, 0, 0, h);
  ground.addColorStop(0, '#8b5e34');
  ground.addColorStop(1, '#5a3a1e');
  c.fillStyle = ground;
  c.fillRect(-w * 2, 0, w * 4, h * 3);
  c.strokeStyle = '#ffffff';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-w * 2, 0); c.lineTo(w * 2, 0); c.stroke();
  c.lineWidth = 1.2;
  for (let p = -30; p <= 30; p += 2.5) {
    if (!p) continue;
    const yy = -p * pxPerDeg;
    const size = p % 10 === 0 ? w * 0.2 : p % 5 === 0 ? w * 0.1 : w * 0.05;
    c.beginPath(); c.moveTo(-size, yy); c.lineTo(size, yy); c.stroke();
    if (p % 10 === 0) {
      text(c, String(Math.abs(p)), -size - 10, yy, Math.max(8, w * 0.06), '#fff');
      text(c, String(Math.abs(p)), size + 10, yy, Math.max(8, w * 0.06), '#fff');
    }
  }
  c.restore();
  // Bank scale (fixed) and roll pointer (moves with the horizon).
  const br = Math.min(w, h) * 0.42;
  for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (-90 + b) * RAD;
    const len = b === 0 ? 0 : Math.abs(b) % 30 === 0 ? br * 0.12 : br * 0.07;
    if (b === 0) {
      c.fillStyle = '#ffffff';
      c.beginPath(); c.moveTo(0, -br + 2); c.lineTo(-6, -br - 7); c.lineTo(6, -br - 7); c.closePath(); c.fill();
    } else tick(c, 0, 0, a, br, br + len, 1.5, '#ffffff');
  }
  c.save();
  c.rotate(-roll * RAD);
  c.fillStyle = '#ffd04a';
  c.beginPath(); c.moveTo(0, -br + 1); c.lineTo(-6, -br + 10); c.lineTo(6, -br + 10); c.closePath(); c.fill();
  c.restore();
  if (fd) {
    c.strokeStyle = '#ff6fe0';
    c.lineWidth = 2.5;
    const dx = clamp(fd.roll - roll, -30, 30) * w / 100;
    const dy = -clamp(fd.pitch - pitch, -15, 15) * pxPerDeg;
    c.beginPath();
    c.moveTo(dx, -h * 0.22); c.lineTo(dx, h * 0.22);
    c.moveTo(-w * 0.25, dy); c.lineTo(w * 0.25, dy);
    c.stroke();
  }
  // Fixed aircraft symbol.
  c.strokeStyle = '#ffcc33';
  c.lineWidth = 3.5;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(-w * 0.3, 0); c.lineTo(-w * 0.1, 0); c.lineTo(-w * 0.05, h * 0.05); c.lineTo(0, 0);
  c.lineTo(w * 0.05, h * 0.05); c.lineTo(w * 0.1, 0); c.lineTo(w * 0.3, 0);
  c.stroke();
  c.lineCap = 'butt';
  c.fillStyle = '#ffcc33';
  c.beginPath(); c.arc(0, 0, 2.5, 0, TAU); c.fill();
  c.restore();
}

/** Attitude indicator housed in a round bezel (light aircraft). */
export function attitudeGauge(c, x, y, r, pitch, roll, fd) {
  face(c, x, y, r);
  attitude(c, x, y, r * 2, r * 2, pitch, roll, { round: true, fd });
  glare(c, x, y, r);
}

/** Altimeter: 100 ft long needle, 1000 ft short needle, 10 000 ft pointer, Kollsman window. */
export function altimeter(c, x, y, r, alt, hpa) {
  face(c, x, y, r);
  for (let i = 0; i < 50; i++) {
    const a = -Math.PI / 2 + i / 50 * TAU;
    const major = i % 5 === 0;
    tick(c, x, y, a, r * (major ? 0.8 : 0.88), r * 0.96, major ? 1.8 : 1);
    if (major) text(c, String(i / 5), x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64, Math.max(9, r * 0.2), '#ffffff', 'center', 700);
  }
  // Kollsman window.
  const kw = r * 0.34, kh = r * 0.17, kx = x + r * 0.13;
  c.fillStyle = '#000';
  c.fillRect(kx, y - kh / 2, kw, kh);
  c.strokeStyle = '#59646a';
  c.lineWidth = 1;
  c.strokeRect(kx, y - kh / 2, kw, kh);
  text(c, Math.round(hpa).toString(), kx + kw / 2, y + 0.5, Math.max(7, r * 0.115), '#ffffff', 'center', 600, MONO);
  // Digital aid below the centre.
  c.fillStyle = '#0d1418';
  roundRect(c, x - r * 0.36, y + r * 0.26, r * 0.72, r * 0.2, 3);
  c.fill();
  text(c, `${Math.round(alt).toLocaleString('it-IT')} ft`, x, y + r * 0.36, Math.max(7, r * 0.13), '#d9f2e1', 'center', 600, MONO);
  const a100 = -Math.PI / 2 + (((alt % 1000) + 1000) % 1000) / 1000 * TAU;
  const a1k = -Math.PI / 2 + (((alt % 10000) + 10000) % 10000) / 10000 * TAU;
  const a10k = -Math.PI / 2 + clamp(alt / 100000, 0, 1) * TAU;
  tick(c, x, y, a10k, r * 0.1, r * 0.95, 1.2, '#cfd6d9');
  needle(c, x, y, a1k, r * 0.52, Math.max(5, r * 0.12), '#f4f4ee', 0.1);
  needle(c, x, y, a100, r * 0.88, Math.max(3, r * 0.06), '#ffffff', 0.15);
  hub(c, x, y, r);
  glare(c, x, y, r);
}

/** Turn coordinator: banking aircraft symbol (standard rate marks) and the slip ball. */
export function turnCoordinator(c, x, y, r, turnRate, ball, powered = true) {
  face(c, x, y, r);
  for (const side of [-1, 1]) {
    tick(c, x, y, side < 0 ? Math.PI : 0, r * 0.66, r * 0.9, 3, '#ffffff');
    const a = side < 0 ? Math.PI - 20 * RAD : 20 * RAD;
    tick(c, x, y, a, r * 0.66, r * 0.9, 3, '#ffffff');
  }
  text(c, 'L', x - r * 0.62, y + r * 0.42, Math.max(8, r * 0.16), '#ffffff', 'center', 700);
  text(c, 'R', x + r * 0.62, y + r * 0.42, Math.max(8, r * 0.16), '#ffffff', 'center', 700);
  text(c, '2 MIN', x, y + r * 0.78, Math.max(6, r * 0.1), '#b8c4ca');
  // Inclinometer tube.
  const ty = y + r * 0.42, tw = r * 0.5;
  c.fillStyle = '#d9e3dd';
  roundRect(c, x - tw, ty - r * 0.09, tw * 2, r * 0.18, r * 0.09);
  c.fill();
  c.strokeStyle = '#1b2125';
  c.lineWidth = 1.5;
  for (const dx of [-r * 0.11, r * 0.11]) { c.beginPath(); c.moveTo(x + dx, ty - r * 0.09); c.lineTo(x + dx, ty + r * 0.09); c.stroke(); }
  c.fillStyle = '#111';
  c.beginPath(); c.arc(x + clamp(ball, -1, 1) * (tw - r * 0.08), ty, r * 0.075, 0, TAU); c.fill();
  // Aircraft symbol.
  c.save();
  c.translate(x, y - r * 0.02);
  c.rotate(clamp(turnRate / 3, -2.2, 2.2) * 20 * RAD);
  c.strokeStyle = '#ffffff';
  c.fillStyle = '#ffffff';
  c.lineWidth = Math.max(2.5, r * 0.06);
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(-r * 0.6, 0); c.lineTo(r * 0.6, 0); c.stroke();
  c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -r * 0.16); c.stroke();
  c.beginPath(); c.arc(0, 0, r * 0.09, 0, TAU); c.fill();
  c.lineCap = 'butt';
  c.restore();
  if (!powered) {
    c.fillStyle = '#d23a2a';
    c.fillRect(x - r * 0.24, y - r * 0.56, r * 0.48, r * 0.18);
    text(c, 'OFF', x, y - r * 0.47, Math.max(7, r * 0.12), '#fff', 'center', 700);
  }
  glare(c, x, y, r);
}

/** Heading indicator: rotating compass card, lubber line and the autopilot heading bug. */
export function headingIndicator(c, x, y, r, heading, bug = null) {
  face(c, x, y, r);
  c.save();
  c.translate(x, y);
  c.rotate(-heading * RAD);
  for (let d = 0; d < 360; d += 5) {
    const a = (d - 90) * RAD;
    const major = d % 10 === 0;
    tick(c, 0, 0, a, r * (major ? 0.78 : 0.85), r * 0.95, major ? 1.6 : 1);
    if (d % 30 === 0) {
      const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] ?? String(d / 10);
      c.save();
      c.rotate(d * RAD);
      text(c, label, 0, -r * 0.62, Math.max(9, r * (label.length === 1 && 'NESW'.includes(label) ? 0.22 : 0.18)), 'NESW'.includes(label) ? '#ffd56b' : '#ffffff', 'center', 700);
      c.restore();
    }
  }
  if (bug !== null) {
    c.save();
    c.rotate(bug * RAD);
    c.fillStyle = '#ff9a2e';
    c.fillRect(-r * 0.1, -r * 0.98, r * 0.2, r * 0.1);
    c.restore();
  }
  c.restore();
  // Fixed lubber line, 45° marks and aircraft silhouette.
  c.fillStyle = '#ff9a2e';
  c.beginPath(); c.moveTo(x, y - r * 0.8); c.lineTo(x - r * 0.07, y - r * 0.98); c.lineTo(x + r * 0.07, y - r * 0.98); c.closePath(); c.fill();
  for (const a of [45, 135, 225, 315]) tick(c, x, y, (a - 90) * RAD, r * 0.98, r * 1.06, 2, '#ffffff');
  c.save();
  c.translate(x, y);
  c.fillStyle = '#ff9a2e';
  c.beginPath();
  c.moveTo(0, -r * 0.3); c.lineTo(r * 0.05, -r * 0.1); c.lineTo(r * 0.32, 0); c.lineTo(r * 0.32, r * 0.06); c.lineTo(r * 0.05, r * 0.02);
  c.lineTo(r * 0.04, r * 0.2); c.lineTo(r * 0.12, r * 0.26); c.lineTo(-r * 0.12, r * 0.26); c.lineTo(-r * 0.04, r * 0.2); c.lineTo(-r * 0.05, r * 0.02);
  c.lineTo(-r * 0.32, r * 0.06); c.lineTo(-r * 0.32, 0); c.lineTo(-r * 0.05, -r * 0.1); c.closePath();
  c.fill();
  c.restore();
  text(c, String(Math.round(wrap360(heading)) || 360).padStart(3, '0'), x, y + r * 0.44, Math.max(7, r * 0.13), '#d9f2e1', 'center', 600, MONO);
  glare(c, x, y, r);
}

/** Vertical speed indicator: zero at nine o'clock, ±2000 ft/min. */
export function verticalSpeed(c, x, y, r, fpm) {
  face(c, x, y, r);
  const ang = (v) => Math.PI + clamp(v / 2000, -1, 1) * 170 * RAD;
  for (let v = -2000; v <= 2000; v += 100) {
    const major = v % 500 === 0;
    tick(c, x, y, ang(v), r * (major ? 0.8 : 0.88), r * 0.96, major ? 1.8 : 1);
    if (major && v !== 0 && Math.abs(v) <= 2000) {
      const a = ang(v);
      text(c, String(Math.abs(v) / 100), x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64, Math.max(8, r * 0.17));
    }
  }
  text(c, '0', x - r * 0.64, y, Math.max(8, r * 0.17));
  text(c, 'UP', x - r * 0.3, y - r * 0.32, Math.max(6, r * 0.1), '#b8c4ca');
  text(c, 'DN', x - r * 0.3, y + r * 0.32, Math.max(6, r * 0.1), '#b8c4ca');
  text(c, 'V/S', x + r * 0.22, y + r * 0.2, Math.max(6, r * 0.1), '#b8c4ca');
  text(c, '×100 FT/MIN', x + r * 0.22, y + r * 0.32, Math.max(5, r * 0.075), '#8a979e');
  needle(c, x, y, ang(fpm), r * 0.86, Math.max(3, r * 0.07));
  hub(c, x, y, r);
  glare(c, x, y, r);
}

/** Tachometer with green arc and red line. */
export function tachometer(c, x, y, r, rpm, { redline = 2700, green = [2100, 2700], max = 3500 } = {}) {
  face(c, x, y, r);
  const ang = (v) => Math.PI * 0.75 + clamp(v / max, 0, 1) * Math.PI * 1.5;
  arc(c, x, y, r * 0.86, ang(green[0]), ang(green[1]), r * 0.09, '#33b24a');
  tick(c, x, y, ang(redline), r * 0.74, r * 0.97, Math.max(2, r * 0.05), '#e0352b');
  for (let v = 0; v <= max; v += 100) {
    const major = v % 500 === 0;
    tick(c, x, y, ang(v), r * (major ? 0.76 : 0.85), r * 0.95, major ? 1.6 : 1);
    if (v % 1000 === 0 || (r > 50 && v % 500 === 0)) {
      const a = ang(v);
      text(c, String(v / 100), x + Math.cos(a) * r * 0.58, y + Math.sin(a) * r * 0.58, Math.max(7, r * 0.17));
    }
  }
  text(c, 'RPM', x, y + r * 0.32, Math.max(6, r * 0.12), '#b8c4ca');
  text(c, String(Math.round(rpm)), x, y + r * 0.56, Math.max(7, r * 0.15), '#d9f2e1', 'center', 600, MONO);
  needle(c, x, y, ang(rpm), r * 0.84, Math.max(3, r * 0.08));
  hub(c, x, y, r);
  glare(c, x, y, r);
}

/** Labelled horizontal bar gauge used by the engine column. */
function bar(c, x, y, w, label, value, min, max, valueText, { green = null, warn = null } = {}) {
  text(c, label, x, y, 9, '#9fb1ba', 'left', 600);
  text(c, valueText, x + w, y, 10, '#e4f2ee', 'right', 600, MONO);
  const by = y + 8, bw = w;
  c.fillStyle = '#1a252b';
  c.fillRect(x, by, bw, 5);
  if (green) {
    c.fillStyle = '#245c33';
    c.fillRect(x + bw * clamp((green[0] - min) / (max - min), 0, 1), by, bw * clamp((green[1] - green[0]) / (max - min), 0, 1), 5);
  }
  const f = clamp((value - min) / (max - min), 0, 1);
  c.fillStyle = warn && warn(value) ? '#ffb347' : '#e8f1f2';
  c.beginPath(); c.moveTo(x + bw * f, by - 3); c.lineTo(x + bw * f - 4, by - 8); c.lineTo(x + bw * f + 4, by - 8); c.closePath(); c.fill();
  c.fillRect(x + bw * f - 1, by - 2, 2, 9);
}

/** Light-aircraft panel: six-pack plus engine instruments and radio stack. */
export function drawGaPanel(c, w, h, d) {
  const { i, fm, sim, def } = d;
  const engine = fm.engines[0] || {};
  const colW = clamp(w * 0.27, 190, 300);
  const packW = w - colW - 18;
  const r1 = Math.min(h / 2 - 9, packW / 12 - 7);
  const r2 = Math.min(h / 4 - 7, packW / 6 - 9);
  const oneRow = r1 >= r2;
  const r = Math.max(20, oneRow ? r1 : r2);
  const speeds = def.speeds || {}, limits = def.limits || {};
  const flapVfe = Math.max(...(def.controls?.flapDetents || []).map((f) => f.vfe || 0), speeds.vs1 || 0);
  const powered = !!fm.systems.avionicsPowered;
  const fd = sim.ap?.fd && powered ? { roll: sim.ap.phiCmd, pitch: sim.ap.thetaCmd } : null;
  const gauges = [
    (x, y) => airspeed(c, x, y, r, i.asi, { vs0: speeds.vs0, vs1: speeds.vs1, vfe: flapVfe, vno: limits.vno || limits.vne * 0.8, vne: limits.vne, max: Math.ceil(limits.vne * 1.25 / 20) * 20 }),
    (x, y) => attitudeGauge(c, x, y, r, i.aiPitch, i.aiRoll, fd),
    (x, y) => altimeter(c, x, y, r, i.alt, (fm.kollsman || 101325) / 100),
    (x, y) => turnCoordinator(c, x, y, r, i.turnRate, i.ball, fm.systems.busVolts > 18),
    (x, y) => headingIndicator(c, x, y, r, i.dg, sim.ap?.hdgBug ?? null),
    (x, y) => verticalSpeed(c, x, y, r, i.vsi),
  ];
  // Gauges sit close together like a real panel; spare width becomes margin.
  const cols = oneRow ? 6 : 3;
  const pitch = Math.min(packW / cols, r * 2.32 + 8);
  const left = 9 + (packW - pitch * cols) / 2;
  gauges.forEach((draw, k) => {
    const col = oneRow ? k : k % 3, row = oneRow ? 0 : Math.floor(k / 3);
    const x = left + pitch * (col + 0.5);
    const y = oneRow ? h / 2 : h / 4 + row * h / 2;
    draw(x, y);
  });
  // Engine and radio column.
  const x0 = w - colW - 6;
  c.fillStyle = '#0b1216';
  roundRect(c, x0, 6, colW, h - 12, 8);
  c.fill();
  c.strokeStyle = '#2c3a41';
  c.lineWidth = 1;
  c.stroke();
  const tanks = fm.systems.tanks || [];
  const caps = def.fuel?.tanks || [];
  const f = (v, n) => Number.isFinite(v) ? v.toFixed(n) : '—';
  if (h < 150) {
    // Short panels: engine data as text, then the radio stack.
    const lh = (h - 20) / 7;
    const lines = [
      [`RPM ${Math.round(engine.rpm || 0)}`, `MAP ${f((engine.map || 0) / 3386.39, 1)}`],
      [`CARB ${Math.round(tanks[0]?.qty || 0)} / ${Math.round(tanks[1]?.qty || 0)} kg`, ''],
      [`OLIO ${Math.round((engine.oilTemp || 273) - 273.15)}°C`, `${Math.round(engine.oilPress || 0)} psi`],
    ];
    lines.forEach(([a, b], k) => {
      text(c, a, x0 + 10, 14 + k * lh, 10, '#d7e4e8', 'left', 600, MONO);
      if (b) text(c, b, x0 + colW - 10, 14 + k * lh, 10, '#d7e4e8', 'right', 600, MONO);
    });
    const ry = 14 + 3 * lh + 4;
    if (powered) {
      [['NAV1', f(sim.nav1.active, 2), f(sim.nav1.standby, 2)], ['COM1', f(sim.com1.active, 3), f(sim.com1.standby, 3)], ['XPDR', String(sim.xpdr.code).padStart(4, '0'), sim.xpdr.mode]].forEach(([name, active, standby], k) => {
        text(c, name, x0 + 10, ry + k * lh, 9, '#7f97a2', 'left', 600);
        text(c, active, x0 + 48, ry + k * lh, 11, '#7df0a6', 'left', 600, MONO);
        text(c, standby, x0 + colW - 10, ry + k * lh, 10, '#d7e4e8', 'right', 500, MONO);
      });
      const nav = sim.nav1.valid ? `${sim.nav1.ident}${Number.isFinite(sim.nav1.dme) ? ` · ${sim.nav1.dme.toFixed(1)} NM` : ''}` : 'NAV1 · nessun segnale';
      text(c, nav, x0 + 10, ry + 3 * lh, 9, '#9fd8c8', 'left', 500);
    } else text(c, 'AVIONICA SPENTA', x0 + colW / 2, ry + lh, 11, '#a2825b', 'center', 600);
    return;
  }
  // Radio stack needs four lines at the bottom; the tachometer takes what is left.
  const radioH = 70;
  const tr = Math.max(18, Math.min((h - radioH - 24) / 2, colW * 0.2));
  tachometer(c, x0 + tr + 10, 14 + tr, tr, engine.rpm || 0, { redline: def.engines?.[0]?.redline || 2700 });
  const bx = x0 + tr * 2 + 24, bw = colW - tr * 2 - 34;
  const rows = [
    ['CARB SX', tanks[0]?.qty || 0, 0, caps[0]?.capacity || 1, `${Math.round(tanks[0]?.qty || 0)} kg`, { warn: (v) => v < (caps[0]?.capacity || 1) * 0.15 }],
    ['CARB DX', tanks[1]?.qty || 0, 0, caps[1]?.capacity || 1, `${Math.round(tanks[1]?.qty || 0)} kg`, { warn: (v) => v < (caps[1]?.capacity || 1) * 0.15 }],
    ['OLIO °C', (engine.oilTemp || 273) - 273.15, 0, 130, `${Math.round((engine.oilTemp || 273) - 273.15)}`, { green: [38, 118] }],
    ['OLIO PSI', engine.oilPress || 0, 0, 120, `${Math.round(engine.oilPress || 0)}`, { green: [50, 90], warn: (v) => v < 20 && (engine.rpm || 0) > 500 }],
  ];
  const rowH = Math.min(26, (tr * 2 + 4) / rows.length);
  rows.forEach(([label, v, lo, hi, txt, o], k) => bar(c, bx, 18 + k * rowH, bw, label, v, lo, hi, txt, o));
  // Radio stack.
  const ry = 30 + tr * 2;
  c.strokeStyle = '#25343b';
  c.beginPath(); c.moveTo(x0 + 8, ry - 6); c.lineTo(x0 + colW - 8, ry - 6); c.stroke();
  if (powered) {
    const lines = [
      ['NAV1', `${f(sim.nav1.active, 2)}`, `${f(sim.nav1.standby, 2)}`],
      ['COM1', `${f(sim.com1.active, 3)}`, `${f(sim.com1.standby, 3)}`],
      ['XPDR', String(sim.xpdr.code).padStart(4, '0'), sim.xpdr.mode],
    ];
    const lh = Math.max(13, Math.min(17, (h - ry - 14) / 4));
    lines.forEach(([name, active, standby], k) => {
      const yy = ry + 6 + k * lh;
      text(c, name, x0 + 10, yy, 9, '#7f97a2', 'left', 600);
      text(c, active, x0 + 52, yy, 12, '#7df0a6', 'left', 600, MONO);
      text(c, standby, x0 + colW - 10, yy, 11, '#d7e4e8', 'right', 500, MONO);
    });
    const nav = sim.nav1.valid ? `${sim.nav1.ident}${Number.isFinite(sim.nav1.dme) ? ` · DME ${sim.nav1.dme.toFixed(1)} NM` : ''}` : 'NAV1 · nessun segnale';
    text(c, nav, x0 + 10, ry + 6 + 3 * lh, 10, '#9fd8c8', 'left', 500);
  } else text(c, 'AVIONICA SPENTA', x0 + colW / 2, ry + 26, 11, '#a2825b', 'center', 600);
}

// ------------------------------------------------------------------ glass cockpit

function tape(c, x, y, w, h, value, { step, label, px, right = false, bug = null, bugColor = '#5fd4ff', bands = [] }) {
  c.save();
  c.fillStyle = '#2b3740';
  c.fillRect(x, y, w, h);
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  const cy = y + h / 2;
  for (const [from, to, color] of bands) {
    const y1 = cy - (to - value) * px, y2 = cy - (from - value) * px;
    c.fillStyle = color;
    c.fillRect(right ? x : x + w - 6, y1, 6, y2 - y1);
  }
  const first = Math.floor((value - h / 2 / px) / step) * step;
  for (let v = first; v <= value + h / 2 / px + step; v += step) {
    const yy = cy - (v - value) * px;
    const major = Math.round(v / step) % label === 0;
    c.strokeStyle = '#e8eef0';
    c.lineWidth = 1.2;
    c.beginPath();
    if (right) { c.moveTo(x, yy); c.lineTo(x + (major ? 10 : 6), yy); } else { c.moveTo(x + w, yy); c.lineTo(x + w - (major ? 10 : 6), yy); }
    c.stroke();
    if (major && v >= 0) text(c, String(Math.round(v)), right ? x + 14 : x + w - 14, yy, 11, '#e8eef0', right ? 'left' : 'right', 600, MONO);
  }
  if (bug !== null) {
    const yy = clamp(cy - (bug - value) * px, y + 4, y + h - 4);
    c.fillStyle = bugColor;
    c.beginPath();
    if (right) { c.moveTo(x, yy); c.lineTo(x + 8, yy - 6); c.lineTo(x + 8, yy + 6); } else { c.moveTo(x + w, yy); c.lineTo(x + w - 8, yy - 6); c.lineTo(x + w - 8, yy + 6); }
    c.closePath(); c.fill();
  }
  c.restore();
  // Current value box.
  c.fillStyle = '#000';
  c.strokeStyle = '#ffd34d';
  c.lineWidth = 1.5;
  c.fillRect(x - 2, cy - 12, w + 4, 24);
  c.strokeRect(x - 2, cy - 12, w + 4, 24);
  text(c, String(Math.round(value)), x + w / 2, cy + 0.5, 15, '#7df07f', 'center', 700, MONO);
}

/** Primary flight display: FMA, attitude, speed and altitude tapes, V/S and heading scale. */
function pfd(c, x, y, w, h, d) {
  const { i, fm, sim, def } = d;
  const ap = sim.ap || {};
  c.fillStyle = '#05080a';
  c.fillRect(x, y, w, h);
  // Flight mode annunciator.
  const fmaH = 16;
  const cells = [ap.athr ? (ap.athrMode || 'SPEED') : '', ap.engaged || ap.fd ? ap.lateral || '' : '', ap.engaged || ap.fd ? ap.vertical || '' : '', ap.engaged ? 'AP1' : ap.fd ? 'FD' : ''];
  cells.forEach((v, k) => {
    const cx = x + w / 4 * (k + 0.5);
    text(c, v, cx, y + fmaH / 2 + 1, 10, k === 3 ? '#ffffff' : '#7df07f', 'center', 700);
    if (k) { c.strokeStyle = '#3a474e'; c.beginPath(); c.moveTo(x + w / 4 * k, y + 2); c.lineTo(x + w / 4 * k, y + fmaH); c.stroke(); }
  });
  const top = y + fmaH + 4, bottom = y + h - 22;
  const ah = bottom - top;
  const tapeW = Math.max(40, w * 0.14);
  const ax = x + tapeW + 10, aw = w - tapeW * 2 - 34;
  const fd = ap.fd && fm.systems.avionicsPowered ? { roll: ap.phiCmd, pitch: ap.thetaCmd } : null;
  attitude(c, ax + aw / 2, top + ah / 2, aw, ah, i.aiPitch, i.aiRoll, { round: false, fd });
  const vs1 = def.speeds?.vs1 || 0, vmax = def.limits?.vne || 400;
  tape(c, x + 4, top, tapeW, ah, i.asi, { step: 10, label: 2, px: ah / 90, bug: ap.spdSel ?? null, bugColor: '#ff6fe0', bands: [[0, vs1, '#d23a2a'], [vmax, vmax + 200, '#d23a2a']] });
  tape(c, x + w - tapeW - 22, top, tapeW, ah, i.alt, { step: 100, label: 5, px: ah / 1100, right: true, bug: ap.altSel ?? null });
  // Vertical speed scale.
  const vx = x + w - 16, vy = top + ah / 2;
  c.fillStyle = '#1d272d';
  c.fillRect(vx - 2, top + 8, 14, ah - 16);
  const vpos = (v) => vy - Math.sign(v) * Math.min(1, Math.sqrt(Math.abs(v) / 6000)) * (ah / 2 - 12);
  c.fillStyle = '#9aa8ae';
  for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) c.fillRect(vx, vpos(v), v ? 4 : 8, 1);
  c.strokeStyle = '#7df07f';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(vx + 12, vy); c.lineTo(vx, vpos(i.vsi)); c.stroke();
  if (Math.abs(i.vsi) > 200) text(c, String(Math.round(i.vsi / 100)), vx + 5, i.vsi > 0 ? top + 4 : bottom - 2, 9, '#7df07f', 'center', 600, MONO);
  // Heading scale.
  const hy = bottom + 2, hh = h - (bottom - y) - 4;
  c.fillStyle = '#2b3740';
  c.fillRect(ax, hy, aw, hh);
  c.save();
  c.beginPath(); c.rect(ax, hy, aw, hh); c.clip();
  const pxDeg = aw / 50;
  for (let dd = Math.floor(i.dg / 5) * 5 - 30; dd <= i.dg + 30; dd += 5) {
    const xx = ax + aw / 2 + (dd - i.dg) * pxDeg;
    c.fillStyle = '#e8eef0';
    c.fillRect(xx, hy, 1, dd % 10 === 0 ? 6 : 3);
    if (dd % 10 === 0) text(c, String(wrap360(dd) / 10), xx, hy + hh - 6, 10, '#e8eef0', 'center', 600, MONO);
  }
  if (ap.hdgBug !== undefined) {
    const off = ((ap.hdgBug - i.dg + 540) % 360) - 180;
    c.fillStyle = '#5fd4ff';
    c.fillRect(clamp(ax + aw / 2 + off * pxDeg, ax + 2, ax + aw - 2) - 4, hy, 8, 4);
  }
  c.restore();
  c.fillStyle = '#ffd34d';
  c.beginPath(); c.moveTo(ax + aw / 2, hy + 6); c.lineTo(ax + aw / 2 - 5, hy - 1); c.lineTo(ax + aw / 2 + 5, hy - 1); c.closePath(); c.fill();
}

/** Navigation display (rose): heading, bug, NAV1 bearing pointer, GPS course and data. */
function nd(c, x, y, w, h, d) {
  const { i, fm, sim } = d;
  c.fillStyle = '#05080a';
  c.fillRect(x, y, w, h);
  const cx = x + w / 2, cy = y + h * 0.56, r = Math.min(w * 0.42, h * 0.42);
  c.save();
  c.translate(cx, cy);
  c.rotate(-i.dg * RAD);
  c.strokeStyle = '#e8eef0';
  for (let dd = 0; dd < 360; dd += 5) {
    const a = (dd - 90) * RAD;
    tick(c, 0, 0, a, r * (dd % 10 === 0 ? 0.9 : 0.95), r, 1.2);
    if (dd % 30 === 0) {
      c.save();
      c.rotate(dd * RAD);
      text(c, String(dd / 10), 0, -r * 0.8, 11, '#e8eef0', 'center', 600, MONO);
      c.restore();
    }
  }
  const pointer = (brg, color, dashed = false) => {
    c.save();
    c.rotate(brg * RAD);
    c.strokeStyle = color;
    c.lineWidth = 2;
    if (dashed) c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(0, r * 0.68); c.lineTo(0, -r * 0.68); c.stroke();
    c.setLineDash([]);
    c.fillStyle = color;
    c.beginPath(); c.moveTo(0, -r * 0.74); c.lineTo(-5, -r * 0.62); c.lineTo(5, -r * 0.62); c.closePath(); c.fill();
    c.restore();
  };
  if (sim.nav1.valid) pointer(wrap360(sim.nav1.radial + 180), '#7df07f');
  if (sim.gps?.current) pointer(sim.gps.brg, '#ff6fe0', true);
  if (sim.ap?.hdgBug !== undefined) {
    c.save();
    c.rotate(sim.ap.hdgBug * RAD);
    c.fillStyle = '#5fd4ff';
    c.fillRect(-4, -r - 2, 8, 7);
    c.restore();
  }
  c.restore();
  // Track diamond and aircraft symbol.
  const trk = ((fm.track - i.dg + 540) % 360) - 180;
  if (fm.gsKt > 20) {
    const a = (trk - 90) * RAD;
    c.fillStyle = '#7df07f';
    c.save(); c.translate(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97); c.rotate(Math.PI / 4); c.fillRect(-3, -3, 6, 6); c.restore();
  }
  c.strokeStyle = '#ffd34d';
  c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(cx, cy - 12); c.lineTo(cx, cy + 12); c.moveTo(cx - 10, cy - 2); c.lineTo(cx + 10, cy - 2); c.moveTo(cx - 4, cy + 9); c.lineTo(cx + 4, cy + 9); c.stroke();
  c.fillStyle = '#ffd34d';
  c.beginPath(); c.moveTo(cx, y + h * 0.56 - r - 2); c.lineTo(cx - 6, cy - r - 12); c.lineTo(cx + 6, cy - r - 12); c.closePath(); c.fill();
  const compact = w < 210;
  text(c, String(Math.round(wrap360(i.dg)) || 360).padStart(3, '0'), compact ? x + w - 6 : cx, y + 10, 13, '#e8eef0', compact ? 'right' : 'center', 700, MONO);
  const windTo = Math.hypot(fm.wind.x, fm.wind.y);
  text(c, compact ? `GS ${Math.round(fm.gsKt)}` : `GS ${Math.round(fm.gsKt)}  TAS ${Math.round(fm.tas / 0.5144)}`, x + 6, y + 10, 10, '#e8eef0', 'left', 600, MONO);
  if (!compact) text(c, `${String(Math.round(wrap360(Math.atan2(-fm.wind.y, -fm.wind.x) / RAD))).padStart(3, '0')}°/${Math.round(windTo / 0.5144)}`, x + 6, y + 23, 10, '#9fd8c8', 'left', 600, MONO);
  const navText = sim.nav1.valid ? `${sim.nav1.ident}${Number.isFinite(sim.nav1.dme) ? ` ${sim.nav1.dme.toFixed(1)} NM` : ''}` : '';
  const gpsText = sim.gps?.current ? `${sim.gps.current.id} ${(sim.gps.dist / 1852).toFixed(1)} NM` : '';
  // Narrow displays show one line: the GPS destination if any, otherwise the NAV1 station.
  if (navText && (!compact || !gpsText)) text(c, navText, x + 6, y + h - 10, 10, '#7df07f', 'left', 600, MONO);
  if (gpsText) text(c, gpsText, x + w - 6, y + h - 10, 10, '#ff6fe0', 'right', 600, MONO);
}

/** Engine / systems page: N1 dials, EGT, fuel flow, flaps, gear, fuel. */
function enginePage(c, x, y, w, h, d) {
  const { fm, def } = d;
  c.fillStyle = '#05080a';
  c.fillRect(x, y, w, h);
  const engines = fm.engines;
  if (h < 140 || w < 220) {
    // Compact: one text line per engine, then configuration.
    const sys = fm.systems;
    const lh = Math.min(16, (h - 12) / (engines.length + 3));
    engines.forEach((e, k) => {
      const yy = y + 10 + k * lh;
      text(c, `N1${engines.length > 1 ? k + 1 : ''}`, x + 6, yy, 9, '#9fb1ba', 'left', 600);
      text(c, (e.n1 || 0).toFixed(1), x + 62, yy, 12, '#7df07f', 'right', 700, MONO);
      text(c, `EGT ${Math.round((e.egt || 288) - 273.15)}  FF ${Math.round((e.fuelFlow || 0) * 3600)}`, x + w - 6, yy, 10, '#e8eef0', 'right', 600, MONO);
    });
    const yy = y + 10 + engines.length * lh + 4;
    text(c, `FLAP ${def.controls?.flapDetents?.[sys.flapsLever]?.name ?? ''}`, x + 6, yy, 10, '#e8eef0', 'left', 700);
    if (def.controls?.retractableGear) {
      const down = sys.gearPos > 0.98, up = sys.gearPos < 0.02;
      text(c, down ? 'GEAR ▼▼▼' : up ? 'GEAR UP' : 'GEAR ▽▽▽', x + w - 6, yy, 10, down ? '#7df07f' : up ? '#9fb1ba' : '#ffb347', 'right', 700);
    }
    text(c, `FOB ${Math.round(sys.fuelTotal)} KG`, x + 6, yy + lh, 10, '#e8eef0', 'left', 600, MONO);
    if (sys.parkingBrake) text(c, 'PARK BRK', x + w - 6, yy + lh, 10, '#ffb347', 'right', 700);
    else if ((sys.spoilers || 0) > 0.05) text(c, 'SPD BRK', x + w - 6, yy + lh, 10, '#ffb347', 'right', 700);
    return;
  }
  const n = engines.length;
  const r = Math.max(16, Math.min(w / n / 2 - 18, h * 0.24));
  engines.forEach((e, k) => {
    const cx = x + w / n * (k + 0.5), cy = y + r + 12;
    const ang = (v) => Math.PI * 0.8 + clamp(v / 110, 0, 1) * Math.PI * 1.25;
    arc(c, cx, cy, r, ang(0), ang(110), 2, '#e8eef0');
    arc(c, cx, cy, r, ang(100), ang(110), 3, '#d23a2a');
    c.fillStyle = 'rgba(125,240,127,0.25)';
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r - 2, ang(0), ang(e.n1 || 0)); c.closePath(); c.fill();
    tick(c, cx, cy, ang(e.n1 || 0), 0, r, 2.5, '#7df07f');
    c.fillStyle = '#000';
    c.strokeStyle = '#59646a';
    roundRect(c, cx + r * 0.05, cy + r * 0.2, r * 0.95, 18, 3);
    c.fill(); c.stroke();
    text(c, (e.n1 || 0).toFixed(1), cx + r * 0.52, cy + r * 0.2 + 9.5, 13, '#7df07f', 'center', 700, MONO);
    text(c, n > 1 ? `N1 · ${k + 1}` : 'N1', cx - r * 0.45, cy + r * 0.55, 9, '#9fb1ba');
    text(c, `EGT ${Math.round((e.egt || 288) - 273.15)} °C   FF ${Math.round((e.fuelFlow || 0) * 3600)} kg/h`, cx, cy + r + 12, 10, '#e8eef0', 'center', 600, MONO);
  });
  const sys = fm.systems;
  const ly = Math.min(y + h - 38, y + r * 2 + 52);
  const flapName = def.controls?.flapDetents?.[sys.flapsLever]?.name ?? '';
  text(c, `FLAP ${flapName}`, x + 8, ly, 11, '#e8eef0', 'left', 700);
  c.fillStyle = '#1a252b';
  c.fillRect(x + 8, ly + 9, w * 0.45, 5);
  c.fillStyle = '#5fd4ff';
  c.fillRect(x + 8, ly + 9, w * 0.45 * clamp(sys.flaps || 0, 0, 1), 5);
  if (def.controls?.retractableGear) {
    const down = sys.gearPos > 0.98, up = sys.gearPos < 0.02;
    const gearText = down ? '▼  ▼  ▼' : up ? 'UP' : '▽  ▽  ▽';
    text(c, gearText, x + w - 8, ly + 4, 13, down ? '#7df07f' : up ? '#9fb1ba' : '#ffb347', 'right', 700);
    text(c, 'GEAR', x + w - 8, ly + 20, 9, '#9fb1ba', 'right');
  }
  text(c, `FOB ${Math.round(sys.fuelTotal)} KG`, x + 8, ly + 30, 11, '#e8eef0', 'left', 600, MONO);
  if (def.controls?.spoilers && (sys.spoilers || 0) > 0.05) text(c, 'SPD BRK', x + w - 8, ly + 34, 11, '#ffb347', 'right', 700);
  if (sys.parkingBrake) text(c, 'PARK BRK', x + w - 8, y + h - 10, 11, '#ffb347', 'right', 700);
}

/** Glass cockpit: PFD, ND and engine/system page side by side. */
export function drawGlassPanel(c, w, h, d) {
  if (!d.fm.systems.avionicsPowered) {
    text(c, 'AVIONICA SPENTA', w / 2, h / 2, 14, '#a2825b');
    return;
  }
  const gap = 8;
  const pw = Math.min(w * 0.44, h * 1.9), ndw = Math.min(w * 0.3, h * 1.3);
  const ew = Math.min(w - pw - ndw - gap * 4, h * 2.2);
  // Centre the three displays when the panel is wider than they need.
  const used = pw + ndw + (ew > 80 ? ew + gap : 0) + gap * 2;
  const frame = (x, ww) => { c.fillStyle = '#11181c'; roundRect(c, x - 3, 3, ww + 6, h - 6, 6); c.fill(); };
  const x1 = Math.max(gap, (w - used) / 2), x2 = x1 + pw + gap, x3 = x2 + ndw + gap;
  frame(x1, pw); frame(x2, ndw); if (ew > 80) frame(x3, ew);
  pfd(c, x1, 6, pw, h - 12, d);
  nd(c, x2, 6, ndw, h - 12, d);
  if (ew > 80) enginePage(c, x3, 6, ew, h - 12, d);
}
