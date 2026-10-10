import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { read3mf } from '../src/threemf.js';
import { repairMesh } from '../src/repair.js';
import { orientPhoi, phoiStats, prepareFaces, bestLayout, plasterCalc, meshVolume, countOpenEdges } from '../src/mold.js';
import { buildShell, invertPhoi } from '../src/shell.js';
const b = readFileSync(process.argv[2]);
const r3 = await read3mf(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
const g0 = new THREE.BufferGeometry(); g0.setAttribute('position', new THREE.BufferAttribute(r3.pos, 3));
const rep = repairMesh(g0, { voxel: 1.3, solid: true, snap: true, caps: ['-z'] });
const ph = orientPhoi(rep.geometry, { unit: 1, rx: 270, rz: 0, shrink: 0.12 }); const st = phoiStats(ph);
console.log('phôi (đã bù co ngót):', st.size.map((v) => v.toFixed(0)).join(' × '), 'mm | thể tích', (st.volume / 1000).toFixed(0), 'cm3 | bán kính lớn nhất quanh trục', st.rmax.toFixed(0), 'mm');
const wall = 25, spare = 25, base = 20, pourR = 20;
const bl = bestLayout(prepareFaces(invertPhoi(ph, spare)), 1); console.log('chia mảnh tự chọn:', bl.n, 'mảnh');
const sh = buildShell(ph, { angles: bl.angles, wall, shell: 2, divider: 1.2, gap: 0.3, spare, pourR, base, keyR: 5, clear: 0.3, keyType: 'ball', keyCount: 2 });
const H = st.H, yTop = spare + H + base, vSprue = Math.PI * pourR * pourR * spare, vPhoi = st.volume;
// bao quanh theo trục (phôi đặt tâm bbox ở trục) và theo hộp chữ nhật
const R = st.rmax + wall, cyl = Math.PI * R * R * yTop - vPhoi - vSprue;
const bx = (st.size[0] + 2 * wall) * (st.size[2] + 2 * wall) * yTop - vPhoi - vSprue;
const rows = [['Uốn theo phôi (hiện tại)', sh.plasterMm3, 2 * (sh.dims.D / 2)], ['Hình trụ tròn', cyl, 2 * R], ['Hình hộp chữ nhật', bx, null]];
for (const [name, v, d] of rows) { const c = plasterCalc(v, 0.7, 10); console.log(name.padEnd(26), 'thạch cao đặc', (v / 1e6).toFixed(2), 'L | pha', (c.plasterG / 1000).toFixed(2), 'kg + nước', (c.waterMl / 1000).toFixed(2), 'L', d ? '| đường kính ngoài ' + d.toFixed(0) + ' mm' : `| ${(st.size[0] + 2 * wall).toFixed(0)} × ${(st.size[2] + 2 * wall).toFixed(0)} mm`); }
const tri = (p) => (p.geometry.attributes.position.count / 3) | 0;
console.log('chi tiết in (hiện tại): vỏ', sh.parts.filter((p) => p.kind === 'panel').map(tri).join(','), 'mặt | vách', sh.parts.filter((p) => p.kind === 'divider').map(tri).join(','), 'mặt');
console.log('cao hộp', yTop + 4, 'mm');
