import { reliefFromImage, reliefDraft, limitSlope } from '../src/photo.js';
const W = 200, H = 150, data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, d = Math.hypot(x - 100, y - 75); const v = d < 45 ? 250 : 10; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
const r = reliefFromImage({ data, width: W, height: H }, { widthMm: 100, depthMm: 8, baseMm: 4, cut: false, blur: 0, gridW: 200 });
const a = reliefDraft(r.hgt, r.gw, r.gh, 100, 8, 5); console.log('trước', (a.badFrac * 100).toFixed(2) + '% ô thiếu góc thoát, nhỏ nhất', a.minDraft.toFixed(1) + '°');
const l = limitSlope(r.hgt, r.gw, r.gh, 100, 8, 5), b = reliefDraft(l, r.gw, r.gh, 100, 8, 5); console.log('sau', (b.badFrac * 100).toFixed(2) + '%', b.minDraft.toFixed(1) + '°', 'đỉnh còn', Math.max(...l).toFixed(2));
{ const sx = 100 / (r.gw - 1), a = (sx / 8) / Math.tan(5 * Math.PI / 180); let mx = 0, wh = null;
  for (let y = 1; y < r.gh - 1; y++) for (let x = 1; x < r.gw - 1; x++) for (const [dx, dy] of [[1,0],[0,1]]) { const d = Math.abs(l[y*r.gw+x] - l[(y+dy)*r.gw+x+dx]); if (d > mx) { mx = d; wh = [x, y, dx, dy]; } }
  console.log('a', a.toFixed(4), 'max neighbor diff', mx.toFixed(4), wh, 'gw', r.gw); }
