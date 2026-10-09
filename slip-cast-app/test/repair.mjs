import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { readFileSync } from 'node:fs';
import { cleanGeometry, countOpenEdges, meshVolume, orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { repairMesh } from '../src/repair.js';
import { buildShell } from '../src/shell.js';
const buf = readFileSync('test/tuong_gau_test.stl');
const good = cleanGeometry(new STLLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
const vol0 = Math.abs(meshVolume(good)); console.log('chuẩn: vol', (vol0 / 1000).toFixed(1), 'cm3, mở', countOpenEdges(good));
function damage(g, frac, flipFrac, seed) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const ix = g.index.array, keep = [];
  for (let i = 0; i < ix.length; i += 3) { const r = rnd(); if (r < frac) continue; if (r > 1 - flipFrac) keep.push(ix[i], ix[i + 2], ix[i + 1]); else keep.push(ix[i], ix[i + 1], ix[i + 2]); }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', g.attributes.position.clone()); o.setIndex(keep); return o;
}
for (const [frac, flip] of [[0.002, 0], [0.01, 0.02], [0.03, 0.05]]) {
  const bad = damage(good, frac, flip, 7);
  const t = Date.now(); const r = repairMesh(bad, { res: 180 });
  const vol = Math.abs(meshVolume(r.geometry));
  console.log(`bỏ ${frac * 100}% mặt, lật ${flip * 100}% -> mở trước ${countOpenEdges(cleanGeometry(bad))}, sau vá ${countOpenEdges(r.geometry)}, vol ${(vol / 1000).toFixed(1)} cm3 (${((vol / vol0 - 1) * 100).toFixed(1)}%), voxel ${r.voxel.toFixed(2)} mm, close ${r.close}, ${Date.now() - t} ms, tris ${r.geometry.index.count / 3}`);
}
// hộp bao trên bản vá
const bad = damage(good, 0.01, 0.02, 7), r = repairMesh(bad, { res: 180 });
const ph = orientPhoi(r.geometry, { shrink: 0.12 }), F = prepareFaces(ph), bl = bestLayout(F, 1);
const t = Date.now(); const sh = buildShell(ph, { angles: bl.angles, wall: 25, shell: 2, divider: 1.6, gap: 0.3, spare: 25, pourR: 12, base: 20, keyR: 4, clear: 0.3 });
console.log('hộp bao trên bản đã vá:', bl.n, 'mảnh,', Date.now() - t, 'ms, thạch cao', (sh.plasterMm3 / 1e6).toFixed(2), 'L');
// lỗ lớn: cắt hẳn một mảng 25% bề mặt
{ const ix = good.index.array, p = good.attributes.position, keep = []; for (let i = 0; i < ix.length; i += 3) { if (p.getX(ix[i]) > 20 && p.getY(ix[i]) > 80) continue; keep.push(ix[i], ix[i + 1], ix[i + 2]); }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', p.clone()); o.setIndex(keep);
  try { const rr = repairMesh(o, { res: 160 }); console.log('lỗ lớn: vá được, close', rr.close, 'vol', (Math.abs(meshVolume(rr.geometry)) / vol0 * 100).toFixed(0) + '% so với chuẩn'); } catch (e) { console.log('lỗ lớn:', e.message); } }
