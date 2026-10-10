import { readFileSync, writeFileSync } from 'node:fs';
import { read3mf } from '../src/threemf.js';
const f = process.argv[2];
const t = Date.now(); const b = readFileSync(f);
const r = await read3mf(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), (m) => console.log(' ·', m));
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < r.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], r.pos[i + k]); mx[k] = Math.max(mx[k], r.pos[i + k]); }
console.log('mặt', r.tris, 'vật thể', r.objects, 'kích thước', mx.map((v, k) => (v - mn[k]).toFixed(2)).join(' × '), 'góc nhỏ', mn.map((v) => v.toFixed(2)).join(','), '|', Date.now() - t, 'ms');
