import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { read3mf } from '../src/threemf.js';
import { cleanGeometry, countOpenEdges, meshVolume, outwardVote } from '../src/mold.js';
const b = readFileSync(process.argv[2]);
const r = await read3mf(new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), () => {});
const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); g0.computeBoundingBox();
console.log('vật thể', r.objects, 'mặt', r.pos.length / 9, 'bbox', g0.boundingBox.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(1)));
const t = Date.now(); const g = cleanGeometry(g0); console.log('làm sạch', Date.now() - t, 'ms | mặt', g.index.count / 3, '| cạnh hở', countOpenEdges(g), '| thể tích', (meshVolume(g) / 1000).toFixed(1), 'cm3 | phiếu', outwardVote(g));
