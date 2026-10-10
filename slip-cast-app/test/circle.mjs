import * as THREE from 'three';
import { minEnclosingCircle, orientPhoi, phoiStats } from '../src/mold.js';
// kiểm tra đúng: điểm ngẫu nhiên, so với vét cạn
let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
for (let t = 0; t < 5; t++) { const pts = Array.from({ length: 60 }, () => [rnd() * 100, rnd() * 60]); const c = minEnclosingCircle(pts);
  const maxd = Math.max(...pts.map((p) => Math.hypot(p[0] - c.x, p[1] - c.z)));
  // thử dịch tâm thật nhỏ: bán kính cần dùng không được nhỏ hơn
  let best = 1e9; for (let dx = -2; dx <= 2; dx += 0.25) for (let dz = -2; dz <= 2; dz += 0.25) best = Math.min(best, Math.max(...pts.map((p) => Math.hypot(p[0] - c.x - dx, p[1] - c.z - dz))));
  console.log('r =', c.r.toFixed(3), '| xa nhất', maxd.toFixed(3), '| tốt nhất khi dịch tâm', best.toFixed(3), maxd <= c.r + 1e-6 && best >= c.r - 1e-6 ? 'ĐÚNG' : 'SAI'); }
// phôi lệch tâm: hộp lệch + 1 tai xa
const g = new THREE.BoxGeometry(40, 60, 40); const e = new THREE.BoxGeometry(10, 10, 10); e.translate(60, 0, 0);
const pos = [...g.attributes.position.array, ...e.attributes.position.array]; const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
for (const center of ['bbox', 'circle']) { const o = orientPhoi(gg, { center }); console.log(center, 'rmax =', phoiStats(o).rmax.toFixed(1)); }
