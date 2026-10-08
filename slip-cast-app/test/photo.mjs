import { colorDiff, otsu, makeMask, extractProfile, latheFromProfile, profileIoU, reliefFromImage } from '../src/photo.js';
import { countOpenEdges, meshVolume } from '../src/mold.js';
// Ảnh giả lập: bình có bóng đổ, nền gradient, nhiễu, hơi lệch tâm
const W = 640, Hh = 960, data = new Uint8ClampedArray(W * Hh * 4);
const prof = (t) => 40 + 55 * Math.sin(Math.PI * Math.min(1, t * 1.15) ** 0.8) - 25 * t * t; // t: 0 đáy -> 1 miệng
const top = 90, bot = 880, cx = 305;
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, g = 235 - (y / Hh) * 25;
  let r = g, gg = g, b = g - 3;
  const t = (bot - y) / (bot - top);
  if (t >= 0 && t <= 1) { const rad = prof(t) * 3; if (Math.abs(x - cx) < rad) { const s = 120 + 90 * Math.cos(((x - cx) / rad) * 1.2); r = s * 0.8; gg = s * 0.55; b = s * 0.4; } }
  if (y > bot && y < bot + 25 && Math.abs(x - cx - 20) < 150) { r -= 25; gg -= 25; b -= 25; } // bóng đổ nhẹ
  const n = (rnd() - 0.5) * 8;
  data[i] = r + n; data[i + 1] = gg + n; data[i + 2] = b + n; data[i + 3] = 255;
}
const img = { data, width: W, height: Hh };
const d = colorDiff(img), thr = otsu(d), m = makeMask(d, W, Hh, thr);
const H_MM = 180;
const p = extractProfile(m, W, Hh, { heightMm: H_MM, smooth: 5 });
// sai số so với chuẩn
let maxErr = 0, sum = 0;
for (let i = 0; i < p.r.length; i++) { const t = p.y[i] / H_MM, truth = prof(t) * 3 * (H_MM / (bot - top)); const e = Math.abs(p.r[i] - truth); maxErr = Math.max(maxErr, e); sum += e; }
console.log('thr', thr, 'xc', p.xc.toFixed(1), 'scale', p.scale.toFixed(4), 'max err mm', maxErr.toFixed(2), 'mean', (sum / p.r.length).toFixed(2));
const g = latheFromProfile(p); console.log('open', countOpenEdges(g), 'vol cm3', (Math.abs(meshVolume(g)) / 1000).toFixed(0), 'IoU', (profileIoU(m, W, p) * 100).toFixed(2) + '%');
const rl = reliefFromImage(img, { widthMm: 120, depthMm: 8, baseMm: 4, cut: true });
console.log('relief', rl.gw, rl.gh, 'open', countOpenEdges(rl.geometry), 'tris', rl.geometry.index.count / 3, 'vol', (meshVolume(rl.geometry) / 1000).toFixed(0));
