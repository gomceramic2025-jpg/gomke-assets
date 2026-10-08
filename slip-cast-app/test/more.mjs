import * as THREE from 'three';
import { reliefFromImage, reliefDraft, limitSlope, reliefMold, latheEmboss, grayMap } from '../src/photo.js';
import { countOpenEdges, meshVolume, orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
// Phù điêu giả lập: hình tròn nổi 8 mm có vách đứng trên nền
const W = 200, H = 150, data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, d = Math.hypot(x - 100, y - 75); const v = d < 45 ? 255 - d * 2 : 10; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
const img = { data, width: W, height: H };
const r = reliefFromImage(img, { widthMm: 100, depthMm: 8, baseMm: 4, cut: true, blur: 0, gridW: 200 });
const d0 = reliefDraft(r.hgt, r.gw, r.gh, 100, 8, 3); console.log('trước: ô thiếu góc thoát', (d0.badFrac * 100).toFixed(2) + '%', 'góc thoát nhỏ nhất', d0.minDraft.toFixed(1));
const lim = limitSlope(r.hgt, r.gw, r.gh, 100, 8, 3); const d1 = reliefDraft(lim, r.gw, r.gh, 100, 8, 3); console.log('sau: ', (d1.badFrac * 100).toFixed(2) + '%', d1.minDraft.toFixed(1));
const r2 = reliefFromImage(img, { widthMm: 100, depthMm: 8, baseMm: 4, cut: true, blur: 0, gridW: 200 });
const m = reliefMold(r.geometry, { margin: 20, plasterTop: 20, wall: 2, floor: 4 });
console.log('mold size', m.size.map((x) => x.toFixed(0)), 'plaster L', (m.plasterMm3 / 1e6).toFixed(3), 'tris', m.geometry.attributes.position.count / 3);
// hoa văn nổi
const prof = { r: Float32Array.from({ length: 100 }, (_, i) => 40 + 15 * Math.sin((i / 99) * Math.PI)), y: Float32Array.from({ length: 100 }, (_, i) => (i / 99) * 160) };
const plain = latheEmboss(prof, { kind: 'none' }), fl = latheEmboss(prof, { kind: 'flutes', count: 8, depth: 5, twist: 0.6, sharp: 1.5, y0: 0.1, y1: 0.85, taper: 0.1 });
console.log('plain vol', (Math.abs(meshVolume(plain)) / 1000).toFixed(0), 'open', countOpenEdges(plain), '| flutes vol', (Math.abs(meshVolume(fl)) / 1000).toFixed(0), 'open', countOpenEdges(fl), 'tris', fl.index.count / 3);
const pi = { gray: Float32Array.from({ length: 64 * 64 }, (_, i) => ((i % 64) < 32) ^ (((i / 64) | 0) < 32) ? 1 : 0), w: 64, h: 64 };
const emb = latheEmboss(prof, { kind: 'image', img: pi, repeat: 4, depth: 3, y0: 0.1, y1: 0.8, taper: 0.1 });
console.log('image emboss open', countOpenEdges(emb));
// chạy qua hộp bao
const ph = orientPhoi(fl, { shrink: 0.12 }); const F = prepareFaces(ph); const bl = bestLayout(F, 1); console.log('best layout', bl.n, bl.theta0, bl.score.toFixed(3));
const t = Date.now(); const sh = buildShell(ph, { angles: bl.angles, wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 14, base: 20, keyR: 4, clear: 0.3 }, () => {}); console.log('shell ms', Date.now() - t, 'plaster L', (sh.plasterMm3 / 1e6).toFixed(2));
