import * as THREE from 'three';
import { orientPhoi } from '../src/mold.js';
import { invertPhoi } from '../src/shell.js';
import { dividerFromSlices } from '../src/slice.js';
import { twistedVase } from '../src/sample.js';
const ph = orientPhoi(twistedVase(), { shrink: 0.12, center: 'bbox' });
const inv = invertPhoi(ph, 25);
const g = dividerFromSlices(inv, { a: 0.07, td: 1.2, y0: 0, y1: 254, limitR: () => 110, sprue: { R: 14, h: 25.5 } });
// cắt ngang bằng tia dọc theo x ở các độ cao y
const rc = new THREE.Raycaster(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
for (const y of [10, 30, 60, 120, 200, 240]) {
  rc.set(new THREE.Vector3(-1, y, 0), new THREE.Vector3(1, 0, 0)); rc.far = 300;
  const hits = rc.intersectObject(m).map((h) => h.point.x.toFixed(1));
  console.log('y', y, hits.join(' '));
}
const dbg = {}; dividerFromSlices(inv, { a: 0.07, td: 1.2, y0: 0, y1: 254, limitR: () => 110, sprue: { R: 14, h: 25.5 }, debug: dbg });
console.log(dbg.cells, dbg.loops.map((l) => l.map((x) => +x.toFixed(0)).join(':')).join(' | '));
console.log(JSON.stringify(dbg.stages));
