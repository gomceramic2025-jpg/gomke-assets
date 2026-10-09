import * as THREE from 'three';
import { orientPhoi, countOpenEdges, cleanGeometry } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
import { twistedVase } from '../src/sample.js';
const ph = orientPhoi(twistedVase(), { shrink: 0.12 });
const base = { wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 14, base: 20, keyR: 5, clear: 0.3 };
for (const [type, angles, cnt] of [['dome', [0, 180], 2], ['dome', [0, 120, 240], 2], ['ball', [0, 90, 180, 270], 2], ['none', [0, 180], 2], ['dome', [0, 180], 3]]) {
  const t = Date.now(); const r = buildShell(ph, { ...base, angles, keyType: type, keyCount: cnt });
  const div = r.parts.filter((p) => p.kind === 'divider').map((p) => (p.geometry.attributes.position.count / 3) | 0);
  console.log(type, angles.length, 'mảnh', cnt, 'chốt/mặt:', Date.now() - t, 'ms | vách', div.join(','), '| keyInfo', JSON.stringify(r.keyInfo), '| bi:', r.parts.find((p) => p.kind === 'key') ? r.parts.find((p) => p.kind === 'key').label : '-');
}
