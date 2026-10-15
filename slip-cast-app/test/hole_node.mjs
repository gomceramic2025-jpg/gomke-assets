import * as THREE from 'three';
import { cleanGeometry, fillSmallHoles, countOpenEdges, meshVolume } from '../src/mold.js';
import { twistedVase } from '../src/sample.js';
const g = cleanGeometry(twistedVase()); const v0 = meshVolume(g), n0 = g.index.count / 3;
// bỏ 40 mặt liền nhau + 3 mặt rải rác tạo lỗ
const ix = Array.from(g.index.array); const keep = [];
for (let i = 0; i < ix.length; i += 3) { const t = i / 3; if ((t >= 3000 && t < 3030) || t === 100 || t === 5000 || t === 7000) continue; keep.push(ix[i], ix[i + 1], ix[i + 2]); }
g.setIndex(keep);
console.log('mặt', n0, '→', keep.length / 3, '| cạnh hở', countOpenEdges(g));
const f = fillSmallHoles(g); console.log(f ? `vá xong: cạnh hở ${countOpenEdges(f)} | mặt ${f.index.count / 3} | thể tích ${(meshVolume(f) / v0 * 100).toFixed(2)}% so với gốc` : 'không vá được');
