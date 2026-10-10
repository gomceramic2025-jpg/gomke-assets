import { readFileSync } from 'node:fs';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { repairMesh } from '../src/repair.js';
import { cleanGeometry, orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
const b = readFileSync('test/tuong_gau_hong.stl'); const g0 = cleanGeometry(new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
for (const snap of [false, true]) {
  const r = repairMesh(g0, { voxel: 1.3, snap }); const ph = orientPhoi(r.geometry, { shrink: 0.12 }); const F = prepareFaces(ph); const bl = bestLayout(F, 1);
  const t = Date.now(); let last = Date.now(); const steps = [];
  const sh = buildShell(ph, { angles: bl.angles, wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 5, clear: 0.3, keyType: 'ball', keyCount: 2 }, (m) => { const n = Date.now(); steps.push(m.slice(0, 22) + ' ' + (n - last) + 'ms'); last = n; });
  console.log(snap ? 'CÓ bám' : 'KHÔNG bám', bl.n, 'mảnh', Date.now() - t, 'ms | vách', sh.parts.filter((p) => p.kind === 'divider').map((p) => p.geometry.attributes.position.count / 3 | 0).join(','), '| vỏ', sh.parts.filter((p) => p.kind === 'panel').map((p) => p.geometry.attributes.position.count / 3 | 0).join(','));
  console.log('   ', steps.join(' | '));
}
