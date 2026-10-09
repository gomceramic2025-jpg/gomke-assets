import * as THREE from 'three';
import { cleanGeometry, orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
for (const detail of [30, 60, 85]) {
  const g = cleanGeometry(new THREE.IcosahedronGeometry(50, detail)); const p = orientPhoi(g, { shrink: 0.1 });
  const tris = g.index.count / 3 | 0; let t = Date.now(); const F = prepareFaces(p); const b = bestLayout(F, 1); const ta = Date.now() - t;
  t = Date.now(); let msg = 'ok';
  try { buildShell(p, { angles: b.angles, wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 4, clear: 0.3 }); } catch (e) { msg = 'FAIL ' + e.message.slice(0, 80); }
  console.log('tris', tris, 'phân tích', ta, 'ms; hộp bao', Date.now() - t, 'ms', msg);
}
