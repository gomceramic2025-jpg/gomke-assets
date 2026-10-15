// Phôi nhiều mặt (đóng kín): giữ nguyên lưới, vách chia vẫn tạo nhanh và mượt
import * as THREE from 'three';
import { handlers } from '../src/tasks.js';
import { orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { invertPhoi, buildShell } from '../src/shell.js';
const prof = []; for (let i = 0; i <= 700; i++) { const t = i / 700, y = t * 180; prof.push(new THREE.Vector2(i === 0 || i === 700 ? 0 : 30 + 22 * Math.sin(t * 9) * Math.cos(t * 4) + 8 * Math.sin(t * 60), y)); }
const lathe = new THREE.LatheGeometry(prof, 600).toNonIndexed(); // 840k mặt
const pos = lathe.attributes.position.array;
let t0 = Date.now();
const r = await handlers.prepare({ geo: { pos: Float32Array.from(pos) }, autoRepair: true, solid: true, voxel: 0.9, heavy: 1200000, budget: 60e6 }, () => {});
console.log('prepare', Date.now() - t0, 'ms', JSON.stringify(r.result.info));
const ph = orientPhoi(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3)), { shrink: 0.12 });
const inv = invertPhoi(ph, 25); const bl = bestLayout(prepareFaces(inv), 1);
t0 = Date.now();
const s = buildShell(ph, { wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 14, base: 20, keyR: 5, clear: 0.3, keyType: 'ball', keyCount: 2, shape: 'cylinder', angles: bl.angles });
console.log('shell', Date.now() - t0, 'ms', bl.n, 'mảnh', s.parts.filter((p) => p.kind === 'divider').map((p) => p.geometry.attributes.position.count / 3).join(','), 'tris vách');
