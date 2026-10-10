import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { repairMesh } from '../src/repair.js';
import { cleanGeometry } from '../src/mold.js';
const b = readFileSync('test/tuong_gau_hong.stl'); const g0 = cleanGeometry(new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
function q(g, name) {
  const p = g.attributes.position, ix = g.index.array; let tiny = 0, thin = 0, n = ix.length / 3; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < ix.length; t += 3) { A.fromBufferAttribute(p, ix[t]); B.fromBufferAttribute(p, ix[t + 1]); C.fromBufferAttribute(p, ix[t + 2]);
    const a = B.distanceTo(C), bb = A.distanceTo(C), c = A.distanceTo(B), s = (a + bb + c) / 2, area = Math.sqrt(Math.max(0, s * (s - a) * (s - bb) * (s - c))), L = Math.max(a, bb, c);
    if (area < 1e-3) tiny++; if (area / (L * L) < 0.02) thin++; }
  console.log(name, 'mặt', n, '| diện tích <0,001 mm²:', tiny, `(${(tiny / n * 100).toFixed(1)}%) | dẹt (tỉ lệ <0,02):`, thin, `(${(thin / n * 100).toFixed(1)}%)`);
}
for (const snap of [false, true]) { const r = repairMesh(g0, { voxel: 1.3, snap, solid: false }); q(r.geometry, snap ? 'có bám ' : 'không bám'); }
