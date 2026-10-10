import { readFileSync } from 'node:fs';
import { handlers } from '../src/tasks.js';
import { meshVolume } from '../src/mold.js';
import { unpack } from '../src/tasks.js';
const b = readFileSync(process.argv[2]);
const t = Date.now();
const { result } = await handlers.prepare({ buf3mf: new Uint8Array(b.buffer, b.byteOffset, b.byteLength), autoRepair: true, solid: true, res: 120 }, (m) => console.log(' ·', m));
const g = unpack(result.geo); g.computeBoundingBox(); const sz = g.boundingBox.getSize({ x: 0, y: 0, z: 0 } && new (await import('three')).Vector3());
console.log(JSON.stringify(result.info), '| thể tích', (Math.abs(meshVolume(g)) / 1000).toFixed(1), 'cm3 | kích thước', [sz.x, sz.y, sz.z].map((v) => v.toFixed(1)).join(' × '), '|', Date.now() - t, 'ms');
