import { readFileSync } from 'node:fs';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { repairMesh } from '../src/repair.js';
import { cleanGeometry, orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
const b = readFileSync('test/tuong_gau_hong.stl'); const g0 = cleanGeometry(new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
const quiet = console.log; 
for (const jit of [+process.argv[2]]) {
  const r = repairMesh(g0, { voxel: 1.3, snap: true });
  if (jit) { let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; const P = r.geometry.attributes.position; for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) + rnd() * 2 * jit, P.getY(i) + rnd() * 2 * jit, P.getZ(i) + rnd() * 2 * jit); r.geometry.computeVertexNormals(); }
  const ph = orientPhoi(r.geometry, { shrink: 0.12 }); const F = prepareFaces(ph); const bl = bestLayout(F, 1);
  const t = Date.now(); const sh = buildShell(ph, { angles: bl.angles, wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 5, clear: 0.3, keyType: 'ball', keyCount: 2 });
  quiet('jitter', jit, '=>', Date.now() - t, 'ms | vách', sh.parts.filter((p) => p.kind === 'divider').map((p) => p.geometry.attributes.position.count / 3 | 0).join(','));
}
