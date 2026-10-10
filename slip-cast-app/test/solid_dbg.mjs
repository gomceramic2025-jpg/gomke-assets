import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { read3mf } from '../src/threemf.js';
import { repairMesh } from '../src/repair.js';
import { meshVolume } from '../src/mold.js';
const b = readFileSync(process.argv[2]);
const r3 = await read3mf(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.BufferAttribute(r3.pos, 3)); g0.computeBoundingBox();
console.log('gốc  min', g0.boundingBox.min.toArray().map((v) => v.toFixed(1)).join(','), 'max', g0.boundingBox.max.toArray().map((v) => v.toFixed(1)).join(','));
const r = repairMesh(g0, { res: 120, solid: true, caps: ['-z'] }); console.log('cách điền:', r.cap);
r.geometry.computeBoundingBox();
console.log('vá   min', r.geometry.boundingBox.min.toArray().map((v) => v.toFixed(1)).join(','), 'max', r.geometry.boundingBox.max.toArray().map((v) => v.toFixed(1)).join(','), 'close', r.close, 'vol', (Math.abs(meshVolume(r.geometry)) / 1000).toFixed(0), 'cm3');
// bề dày theo từng độ cao: đếm đỉnh theo lớp z để thấy hình dạng
const P = r.geometry.attributes.position; const lay = {}; for (let i = 0; i < P.count; i++) { const k = Math.round(P.getZ(i) / 10) * 10; const rr = Math.hypot(P.getX(i) - 165.5, P.getY(i) - 160.8); lay[k] = Math.max(lay[k] || 0, rr); }
console.log('bán kính lớn nhất theo độ cao z:', Object.entries(lay).sort((a, b) => a[0] - b[0]).map(([z, rr]) => z + ':' + rr.toFixed(0)).join('  '));
