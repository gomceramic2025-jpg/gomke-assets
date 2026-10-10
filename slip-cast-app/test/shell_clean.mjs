import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { repairMesh } from '../src/repair.js';
import { cleanGeometry, orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
const file = process.argv[2], snap = process.argv[3] === '1';
const b = readFileSync(file); const g0 = cleanGeometry(new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
const r = repairMesh(g0, { voxel: 1.3, snap });
// kiểm tra đảo pháp tuyến cục bộ (dấu hiệu gập mặt)
const P = r.geometry.attributes.position, ix = r.geometry.index.array; let bad = 0; const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
const vn = new Float32Array(P.count * 3); for (let t = 0; t < ix.length; t += 3) { A.fromBufferAttribute(P, ix[t]); B.fromBufferAttribute(P, ix[t + 1]); C.fromBufferAttribute(P, ix[t + 2]); const n = B.clone().sub(A).cross(C.clone().sub(A)); for (let k = 0; k < 3; k++) { vn[ix[t + k] * 3] += n.x; vn[ix[t + k] * 3 + 1] += n.y; vn[ix[t + k] * 3 + 2] += n.z; } }
for (let t = 0; t < ix.length; t += 3) { A.fromBufferAttribute(P, ix[t]); B.fromBufferAttribute(P, ix[t + 1]); C.fromBufferAttribute(P, ix[t + 2]); const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize(); for (let k = 0; k < 3; k++) { const q = ix[t + k] * 3, l = Math.hypot(vn[q], vn[q + 1], vn[q + 2]) || 1; if ((n.x * vn[q] + n.y * vn[q + 1] + n.z * vn[q + 2]) / l < 0.0) { bad++; break; } } }
console.log(file.split('/').pop(), 'snap', snap, '| mặt', ix.length / 3, '| mặt ngược hướng với đỉnh lân cận (gập):', bad);
const ph = orientPhoi(r.geometry, { shrink: 0.12 }); const bl = bestLayout(prepareFaces(ph), 1);
const t = Date.now(); const sh = buildShell(ph, { angles: bl.angles, wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 5, clear: 0.3, keyType: 'ball', keyCount: 2 });
console.log('   hộp bao', Date.now() - t, 'ms | vách', sh.parts.filter((p) => p.kind === 'divider').map((p) => p.geometry.attributes.position.count / 3 | 0).join(','));
