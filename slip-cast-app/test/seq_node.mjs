import * as THREE from 'three';
import { orientPhoi, prepareFaces, bestLayout, meshVolume } from '../src/mold.js';
import { invertPhoi } from '../src/shell.js';
import { buildSequential } from '../src/seq.js';
import { twistedVase } from '../src/sample.js';
const sph = new THREE.SphereGeometry(30, 48, 32);
for (const [name, g0, angles] of [['cầu 3 mảnh', sph, [0, 120, 240]], ['bình xoắn', twistedVase(), null]]) {
  const ph = orientPhoi(g0, { shrink: 0.12, center: 'bbox' });
  const ang = angles || bestLayout(prepareFaces(invertPhoi(ph, 25)), 1).angles;
  const t = Date.now();
  const r = buildSequential(ph, { angles: ang, wall: 12, spare: 25, pourR: 8, base: 8, keyR: 5, clear: 0.3, keyCount: 2, keyType: 'dome' });
  console.log(name, 'góc', ang.join(','), (Date.now() - t) + ' ms | khay', r.parts.filter((p) => p.kind === 'tray').map((p) => p.label + ' ' + (p.geometry.attributes.position.count / 3) + 'f').join(' | '));
  console.log('  thạch cao mỗi mảnh (mL):', r.pieces.map((p) => (p.plasterMm3 / 1000).toFixed(0)).join(', '), '| tổng', (r.plasterMm3 / 1000).toFixed(0), 'mL | khay', r.dims.L.toFixed(0), '×', r.dims.W.toFixed(0), '×', r.dims.Hh.toFixed(0), '| chốt', JSON.stringify(r.keyInfo));
  const f = r.parts.find((p) => p.kind === 'funnel'); console.log('  phễu thể tích', meshVolume(f.geometry).toFixed(0));
}
