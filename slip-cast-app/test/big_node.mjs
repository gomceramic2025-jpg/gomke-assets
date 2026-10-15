import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { readFileSync } from 'node:fs';
import { handlers } from '../src/tasks.js';
const b = readFileSync(process.argv[2]); const g = new STLLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const pos = g.attributes.position.array; console.log('tris', pos.length / 9);
const t0 = Date.now();
const r = await handlers.prepare({ geo: { pos: Float32Array.from(pos) }, autoRepair: true, solid: true, voxel: 0.9, heavy: +process.argv[3] || 1200000, budget: 60e6 }, (m) => console.log('  ', ((Date.now() - t0) / 1000).toFixed(1), m));
console.log('prepare', Date.now() - t0, 'ms', JSON.stringify(r.result.info));
