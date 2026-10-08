// Tượng gấu dựng bằng trường khoảng cách (SDF) nên lưới luôn kín. Đơn vị mm.
import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { writeFileSync } from 'node:fs';
import { surfaceNets } from './surfacenets_tool.js';
import { cleanGeometry, orientPhoi, phoiStats, countOpenEdges, prepareFaces, bestLayout, analyzeDraftAngles, meshVolume } from '../src/mold.js';
import { buildShell } from '../src/shell.js';

const E = (cx, cy, cz, sx, sy, sz, rz = 0) => ({ c: [cx, cy, cz], s: [sx, sy, sz], rz });
const els = [
  E(0, 52, 0, 36, 46, 32), E(0, 112, 2, 28, 26, 26), E(-20, 134, 0, 10, 10, 7), E(20, 134, 0, 10, 10, 7), E(0, 106, 26, 12, 9, 9),
  E(-48, 68, 6, 11, 28, 12, 0.55), E(48, 68, 6, 11, 28, 12, -0.55), E(-17, 14, 14, 13, 11, 17), E(17, 14, 14, 13, 11, 17),
];
const sd = (x, y, z, e) => { // khoảng cách gần đúng tới ellipsoid
  const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2], c = Math.cos(-e.rz), s = Math.sin(-e.rz);
  const px = dx * c - dy * s, py = dx * s + dy * c;
  const k = Math.hypot(px / e.s[0], py / e.s[1], dz / e.s[2]);
  return (k - 1) * Math.min(...e.s);
};
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const field = (x, y, z) => {
  let d = Math.max(Math.hypot(x, z) - 32, Math.abs(y - 4) - 4); // đế
  for (const e of els) d = smin(d, sd(x, y, z, e), 9);
  return d;
};
const vs = 1.4, nx = 112, ny = 118, nz = 80, ox = -nx * vs / 2, oy = -4 * vs, oz = -nz * vs / 2;
const f = new Float32Array(nx * ny * nz);
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
  const d = field(ox + i * vs, oy + j * vs, oz + k * vs);
  f[(k * ny + j) * nx + i] = Math.min(1, Math.max(0, 0.5 - d / (2 * vs)));
}
let g = surfaceNets(f, nx, ny, nz, vs, (i, j, k) => [ox + i * vs, oy + j * vs, oz + k * vs], { blur: 0, smooth: 3 });
// hướng mặt ra ngoài
let vol = 0; { const p = g.attributes.position.array, ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3; vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6; } }
if (vol < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
g.computeVertexNormals();
console.log('open', countOpenEdges(g), 'vol cm3', (Math.abs(vol) / 1000).toFixed(0), 'tris', g.index.count / 3);
g = orientPhoi(g, { shrink: 0 }); // đặt đáy y=0
const dv = new STLExporter().parse(new THREE.Mesh(g), { binary: true });
writeFileSync('test/tuong_gau_test.stl', Buffer.from(dv.buffer, dv.byteOffset, dv.byteLength));
const ph = orientPhoi(g, { shrink: 0.12 }), st = phoiStats(ph), F = prepareFaces(ph);
console.log('size (sau bù co ngót)', st.size.map((x) => x.toFixed(0)));
const bl = bestLayout(F, 1); const r = analyzeDraftAngles(F, bl.angles, 1);
const pct = (q) => (q[2] / (q[0] + q[1] + q[2]) * 100).toFixed(2) + '%';
console.log('tự chọn:', bl.n, 'mảnh, góc', bl.theta0, 'undercut', pct(r.area));
console.log([2, 3, 4, 6].map((n) => { const a = Array.from({ length: n }, (_, i) => i * 360 / n); return n + ' mảnh ' + pct(analyzeDraftAngles(F, a, 1).area); }).join(' | '));
const t = Date.now();
const sh = buildShell(ph, { angles: bl.angles, wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 4, clear: 0.3 }, () => {});
console.log('hộp bao ms', Date.now() - t, 'thạch cao L', (sh.plasterMm3 / 1e6).toFixed(2), sh.parts.map((p) => p.name + ':' + (p.geometry.attributes.position.count / 3 | 0)).join(' '));
