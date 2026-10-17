// Phôi để ở đơn vị khác mm (m, cm): lưới dựng lại không được rỗng
import * as THREE from 'three';
import { handlers } from '../src/tasks.js';
const prof = []; for (let i = 0; i <= 200; i++) { const t = i / 200; prof.push(new THREE.Vector2(i === 0 || i === 200 ? 0 : 30 + 20 * Math.sin(t * 9), t * 180)); }
const base = new THREE.LatheGeometry(prof, 400).toNonIndexed().attributes.position.array; // 160k mặt, cao 180 đơn vị
for (const [name, k, unit] of [['mm', 1, 1], ['cm', 0.1, 10], ['mét', 0.001, 1000], ['mm nhưng cỡ 5 đơn vị', 0.028, 1]]) {
  const pos = Float32Array.from(base, (v) => v * k);
  for (const heavy of [150000]) {
    try {
      const r = await handlers.prepare({ geo: { pos: Float32Array.from(pos) }, autoRepair: true, solid: true, voxel: 1.3, unit, heavy, budget: 60e6 }, () => {});
      console.log(name.padEnd(22), 'mặt sau', r.result.info.trisAfter, '| ô', r.result.info.voxel && +r.result.info.voxel.toFixed(4));
    } catch (e) { console.log(name.padEnd(22), 'LỖI', e.message); }
  }
}
