import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { read3mf } from '../src/threemf.js';
import { repairMesh } from '../src/repair.js';
import { meshVolume, countOpenEdges } from '../src/mold.js';
const b = readFileSync(process.argv[2]), voxel = +process.argv[3] || 0.9;
const r3 = await read3mf(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.BufferAttribute(r3.pos, 3));
for (const snap of [false, true]) {
  const t = Date.now(); const r = repairMesh(g0, { voxel, solid: true, snap }, (m) => 0);
  // độ lệch của các đỉnh so với bề mặt gốc
  const bvh = new MeshBVH(g0, { indirect: true }); const P = r.geometry.attributes.position, tmp = { point: new THREE.Vector3() }, v = new THREE.Vector3();
  let mean = 0, mx = 0, close = 0, n = 0; for (let i = 0; i < P.count; i += 7) { v.fromBufferAttribute(P, i); const h = bvh.closestPointToPoint(v, tmp, 0, 5); if (!h) continue; n++; mean += h.distance; mx = Math.max(mx, h.distance); if (h.distance < 0.05) close++; }
  console.log(snap ? 'có bám bề mặt' : 'không bám     ', '| voxel', r.voxel.toFixed(2), 'mm | mặt', r.geometry.index.count / 3, '| đã bám', ((r.snapped || 0) * 100).toFixed(0) + '% đỉnh | độ lệch TB', (mean / n).toFixed(3), 'mm, lớn nhất', mx.toFixed(2), 'mm, đỉnh sát <0,05mm', (close / n * 100).toFixed(0) + '%', '| thể tích', (Math.abs(meshVolume(r.geometry)) / 1000).toFixed(0), 'cm3 | hở', countOpenEdges(r.geometry), '|', ((Date.now() - t) / 1000).toFixed(1), 's');
}
