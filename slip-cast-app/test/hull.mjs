import { makeMask, carveHull, hullGeometry } from '../src/photo.js';
import { countOpenEdges, cleanGeometry, meshVolume } from '../src/mold.js';
// Vật thật: bình có tiết diện 3 thùy (đối xứng quay 120°), cao 180 mm, bán kính thay đổi theo độ cao
const H = 180, rBase = (y) => 35 + 18 * Math.sin(Math.PI * Math.min(1, y / H) * 1.1) - 10 * (y / H) ** 2;
const inside = (x, y, z) => { if (y < 0 || y > H) return false; const r = Math.hypot(x, z), a = Math.atan2(z, x); return r <= rBase(y) * (1 + 0.14 * Math.cos(3 * a + y / 60)); };
const W = 400, Hp = 640, ppm = 3.2, xcT = 200, yBot = 600; // ảnh: 3.2 px/mm
const N = 24, views = [];
for (let n = 0; n < N; n++) {
  const th = (2 * Math.PI * n) / N, c = Math.cos(th), s = Math.sin(th), mask = new Uint8Array(W * Hp);
  for (let row = 0; row < Hp; row++) { const y = (yBot - row) / ppm; if (y < 0 || y > H) continue;
    for (let col = 0; col < W; col++) { const sx = (col - xcT) / ppm; let hit = false;
      for (let z = -70; z <= 70 && !hit; z += 0.7) { const x = sx * c - z * s, zz = sx * s + z * c; // quay ngược: điểm trong hệ vật
        if (inside(x, y, zz)) hit = true; }
      if (hit) mask[row * W + col] = 1; } }
  views.push({ mask, w: W, h: Hp, angleDeg: (360 * n) / N });
}
const t0 = Date.now();
for (const flip of [false, true]) {
  const h = carveHull(views, { heightMm: H, res: 128, flip });
  const geo = hullGeometry(h, { blur: 2, smooth: 6 });
  const g2 = cleanGeometry(geo);
  // thể tích thật bằng lưới điểm
  let vt = 0, step = 1.2; for (let y = 0; y < H; y += step) for (let x = -70; x < 70; x += step) for (let z = -70; z < 70; z += step) if (inside(x, y, z)) vt += step ** 3;
  const vol = Math.abs(meshVolume(g2));
  console.log('flip', flip, 'ms', Date.now() - t0, 'tris', g2.index.count / 3, 'open', countOpenEdges(g2), 'vol ratio', (vol / vt).toFixed(4), 'IoU mean', (h.ious.reduce((a, b) => a + b) / N).toFixed(4), 'min', Math.min(...h.ious).toFixed(4));
}
{ const h = carveHull(views, { heightMm: H, res: 128 }); const geo = hullGeometry(h, { blur: 2, smooth: 6 }); const g2 = cleanGeometry(geo);
  const m = new Map(), ix = g2.index.array; for (let i = 0; i < ix.length; i += 3) for (let e = 0; e < 3; e++) { const a = ix[i + e], b = ix[i + (e + 1) % 3], k = a < b ? a * 4294967296 + b : b * 4294967296 + a; m.set(k, (m.get(k) || 0) + 1); }
  const hist = {}; for (const c of m.values()) hist[c] = (hist[c] || 0) + 1; console.log('edge-use histogram', hist, 'IoU', (h.ious.reduce((a,b)=>a+b)/N).toFixed(4)); }
{ const h = carveHull(views, { heightMm: H, res: 128 }); const geo = hullGeometry(h, { blur: 2, smooth: 6 }); console.log('raw open edges', countOpenEdges(geo), 'vol', (Math.abs(meshVolume(geo))/vt0()).toFixed(4)); }
function vt0(){ let vt=0,step=1.2; for (let y=0;y<H;y+=step) for (let x=-70;x<70;x+=step) for (let z=-70;z<70;z+=step) if (inside(x,y,z)) vt+=step**3; return vt; }
{ const h = carveHull(views, { heightMm: H, res: 128 }); const g = hullGeometry(h, { blur: 2, smooth: 0 }); const ix = g.index.array, p = g.attributes.position.array, m = new Map();
  for (let i = 0; i < ix.length; i += 3) for (let e = 0; e < 3; e++) { const a = ix[i + e], b = ix[i + (e + 1) % 3], k = a < b ? a * 4294967296 + b : b * 4294967296 + a; m.set(k, (m.get(k) || 0) + 1); }
  const ys = []; for (const [k, c] of m) if (c === 1) { const a = Math.floor(k / 4294967296); ys.push([p[3*a].toFixed(0), p[3*a+1].toFixed(0), p[3*a+2].toFixed(0)].join(',')); }
  console.log('open (no smooth):', ys.length, ys.slice(0, 12).join(' | ')); }
