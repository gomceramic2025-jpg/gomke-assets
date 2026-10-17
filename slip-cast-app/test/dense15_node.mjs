import * as THREE from 'three';
import { handlers } from '../src/tasks.js';
const prof = []; for (let i = 0; i <= 1000; i++) { const t = i / 1000; prof.push(new THREE.Vector2(i === 0 || i === 1000 ? 0 : 30 + 20 * Math.sin(t * 9) + 5 * Math.sin(t * 80), t * 180)); }
const pos = new THREE.LatheGeometry(prof, 750).toNonIndexed().attributes.position.array;
console.log('mặt', pos.length / 9);
for (const [heavy, budget] of [[1200000, 60e6], [200000, 10e6]]) {
  const t = Date.now();
  const r = await handlers.prepare({ geo: { pos: Float32Array.from(pos) }, autoRepair: true, solid: true, voxel: 0.9, heavy, budget }, () => {});
  const i = r.result.info; console.log('heavy', heavy, (Date.now() - t) + ' ms | mặt sau', i.trisAfter, '| giảm mặt', i.decimated, '| ô', i.voxel && i.voxel.toFixed(2), '| hở', i.openAfter);
}
