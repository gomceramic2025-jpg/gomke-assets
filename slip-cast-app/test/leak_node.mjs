// Vỏ rỗng hở có một khoang kín nhỏ bên trong: không được trả về cái khoang đó làm phôi
import * as THREE from 'three';
import { handlers } from '../src/tasks.js';
const shell = new THREE.SphereGeometry(40, 96, 64, 0, Math.PI * 2, 0, Math.PI * 0.62); // chỏm cầu hở đáy, mặt mỏng (không có độ dày)
const cube = new THREE.BoxGeometry(5, 5, 5); cube.translate(0, 0, 0);
const a = shell.toNonIndexed().attributes.position.array, b = cube.toNonIndexed().attributes.position.array;
const pos = new Float32Array(a.length + b.length); pos.set(a); pos.set(b, a.length);
for (const solid of [true, false]) {
  const r = await handlers.prepare({ geo: { pos: Float32Array.from(pos) }, autoRepair: true, solid, voxel: 1.3, unit: 1, heavy: 150000, budget: 60e6 }, () => {});
  const i = r.result.info; console.log('solid', solid, '| mặt sau', i.trisAfter, '| cap', i.cap, '| ghi chú:', i.note || '-');
}
