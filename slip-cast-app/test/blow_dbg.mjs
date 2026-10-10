import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { repairMesh } from '../src/repair.js';
import { cleanGeometry, orientPhoi } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
const b = readFileSync('test/tuong_gau_test.stl'); const g0 = cleanGeometry(new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
const r = repairMesh(g0, { voxel: 1.3, snap: true }); const ph = orientPhoi(r.geometry, { shrink: 0.12 });
const sh = buildShell(ph, { angles: [0, 90, 180, 270], wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 0, clear: 0.3, keyType: 'none', keyCount: 2 });
const d = sh.parts.filter((p) => p.kind === 'divider')[0].geometry, P = d.attributes.position, n = P.count / 3;
console.log('mặt', n);
const cells = new Map(); const c = new THREE.Vector3();
for (let t = 0; t < n; t++) { c.set(0, 0, 0); for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(P, 3 * t + k)); c.divideScalar(3); const key = [Math.floor(c.x / 10) * 10, Math.floor(c.y / 10) * 10, Math.floor(c.z / 10) * 10].join(','); cells.set(key, (cells.get(key) || 0) + 1); }
console.log('ô đông nhất (x,y,z -> số mặt):', [...cells.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + ' -> ' + v).join(' | '));
// diện tích tam giác nhỏ nhất, phân bố
let tiny = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(); for (let t = 0; t < n; t++) { A.fromBufferAttribute(P, 3 * t); B.fromBufferAttribute(P, 3 * t + 1); C.fromBufferAttribute(P, 3 * t + 2); const ar = B.clone().sub(A).cross(C.clone().sub(A)).length() / 2; if (ar < 1e-3) tiny++; }
console.log('mặt diện tích < 0.001 mm2:', tiny);
