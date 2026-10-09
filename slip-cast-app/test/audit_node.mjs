import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { readFileSync } from 'node:fs';
import { cleanGeometry, orientPhoi, phoiStats, prepareFaces, bestLayout, analyzeDraftAngles, buildMold, buildCasing, countOpenEdges } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
import { twistedVase } from '../src/sample.js';
const buf = readFileSync('test/tuong_gau_test.stl');
const statue = cleanGeometry(new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
const ph = orientPhoi(statue, { shrink: 0.12 });
const T = (name, fn) => { const t = Date.now(); try { const r = fn(); console.log('OK  ', name, (Date.now() - t) + ' ms', r ?? ''); } catch (e) { console.log('FAIL', name, (Date.now() - t) + ' ms', e.message.slice(0, 120)); } };
const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3 | 0;
// 1. khuôn 2 mảnh dạng hộp + hộp đổ với tượng (mặt đối xứng)
T('statue box mold theta=0', () => { const m = buildMold(ph, { shape: 'box', n: 2, theta0: 0, wall: 25, base: 25, spare: 25, pourR: 12, keys: true, tol: 0.4 }); return m.pieces.map((p) => tri(p.geometry)).join(','); });
T('statue casing 0', () => { const m = buildMold(ph, { shape: 'box', n: 2, theta0: 0, wall: 25, base: 25, spare: 25, pourR: 12, keys: true, tol: 0.4 }); const c = buildCasing(m, 0); return tri(c.geometry); });
T('statue casing theta=90', () => { const m = buildMold(ph, { shape: 'box', n: 2, theta0: 90, wall: 25, base: 25, spare: 25, pourR: 12, keys: true, tol: 0.4 }); const c = buildCasing(m, 1); return tri(c.geometry); });
// 2. khuôn tròn nhiều mảnh
for (const n of [3, 5]) T('statue round n=' + n, () => { const m = buildMold(ph, { shape: 'round', n, theta0: 0, wall: 25, base: 25, spare: 25, pourR: 12, keys: true, tol: 0.4 }); return m.pieces.map((p) => tri(p.geometry)).join(','); });
// 3. hộp bao với các góc lệch ngẫu nhiên và số mảnh khác nhau
for (const ang of [[0, 180], [0, 90, 180, 270], [10, 70, 190, 300, 340]]) T('shell angles ' + ang.join('/'), () => { const r = buildShell(ph, { angles: ang, wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 4, clear: 0.3 }); return r.parts.map((p) => tri(p.geometry)).join(','); });
// 4. thông số biên
T('shell wall=10 shell=1 div=0.8', () => buildShell(ph, { angles: [0, 120, 240], wall: 10, shell: 1, divider: 0.8, gap: 0, spare: 8, pourR: 3, base: 10, keyR: 0, clear: 0 }).parts.length);
T('shell wall=0 (sai)', () => buildShell(ph, { angles: [0, 120, 240], wall: 0, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 4, clear: 0.3 }).parts.length);
T('shell duplicate angles', () => buildShell(ph, { angles: [0, 0, 180], wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 4, clear: 0.3 }).parts.length);
T('shell pourR > mouth (60)', () => buildShell(ph, { angles: [0, 120, 240], wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 60, base: 20, keyR: 4, clear: 0.3 }).parts.length);
// 5. hiệu năng phân tích với phôi nhiều mặt
{ const v = twistedVase(); const big = new THREE.IcosahedronGeometry(50, 7); const g = cleanGeometry(big); const p2 = orientPhoi(g, { shrink: 0.1 }); console.log('icosahedron tris', tri(p2));
  T('prepareFaces+bestLayout (' + tri(p2) + ' tris)', () => { const F = prepareFaces(p2); const b = bestLayout(F, 1); return 'n=' + b.n; }); }
