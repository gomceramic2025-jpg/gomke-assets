// Mô phỏng đổ thạch cao vào từng khay: thể tích đổ được so với tính toán, có rò hay không, và các mảnh có chồng lấn khi ghép lại không
import * as THREE from 'three';
import { orientPhoi, prepareFaces, bestLayout } from '../src/mold.js';
import { invertPhoi } from '../src/shell.js';
import { buildSequential } from '../src/seq.js';
import { twistedVase } from '../src/sample.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const vs = 0.8;
function fill(part, zFill) {
  const g = part.geometry; g.computeBoundingBox(); const bb = g.boundingBox, pad = 4;
  const nx = Math.ceil((bb.max.x - bb.min.x) / vs) + 2 * pad, ny = Math.ceil((bb.max.y - bb.min.y) / vs) + 2 * pad, nz = Math.ceil((bb.max.z + 6 - bb.min.z) / vs) + 2 * pad;
  const wall = new Uint8Array(nx * ny * nz), id = (i, j, k) => (k * ny + j) * nx + i;
  const P = g.attributes.position, A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < P.count; t += 3) {
    A.fromBufferAttribute(P, t); B.fromBufferAttribute(P, t + 1); C.fromBufferAttribute(P, t + 2);
    const L = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)), n = Math.max(1, Math.ceil(L / (vs * 0.45)));
    for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) { const u = a / n, v = b / n, w = 1 - u - v;
      const i = Math.floor((A.x * w + B.x * u + C.x * v - bb.min.x) / vs) + pad, j = Math.floor((A.y * w + B.y * u + C.y * v - bb.min.y) / vs) + pad, k = Math.floor((A.z * w + B.z * u + C.z * v - bb.min.z) / vs) + pad;
      if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) wall[id(i, j, k)] = 1; } }
  const kLid = Math.floor((zFill - bb.min.z) / vs) + pad; // mặt trên mức đổ: coi là nắp
  for (let k = kLid + 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) wall[id(i, j, k)] = 1;
  // hạt giống: giữa khay, ngay dưới nắp
  const si = Math.floor(((bb.max.x - bb.min.x) / 2) / vs) + pad, sj = Math.floor(((bb.max.y - bb.min.y) / 2) / vs) + pad;
  const seen = new Uint8Array(wall.length), st = [id(si, sj, kLid)]; let cnt = 0, escaped = false;
  if (wall[st[0]]) return { err: 'hạt giống nằm trong tường' };
  seen[st[0]] = 1;
  const pts = [];
  while (st.length) { const q = st.pop(); cnt++; const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
    if (i < pad - 1 || j < pad - 1 || k < pad - 1 || i > nx - pad || j > ny - pad) escaped = true;
    pts.push(q);
    const go = (qq) => { if (!seen[qq] && !wall[qq]) { seen[qq] = 1; st.push(qq); } };
    if (i > 0) go(q - 1); if (i < nx - 1) go(q + 1); if (j > 0) go(q - nx); if (j < ny - 1) go(q + nx); if (k > 0) go(q - nx * ny); if (k < nz - 1) go(q + nx * ny); }
  return { vol: cnt * vs ** 3, escaped, pts, nx, ny, bb, pad };
}
for (const [name, g0, angles] of [['cầu 3 mảnh', new THREE.SphereGeometry(30, 48, 32), [0, 120, 240]], ['bình xoắn 2', twistedVase(), null]]) {
  const ph = orientPhoi(g0, { shrink: 0.12, center: 'bbox' });
  const ang = angles || bestLayout(prepareFaces(invertPhoi(ph, 25)), 1).angles;
  const r = buildSequential(ph, { angles: ang, wall: 12, spare: 25, pourR: 8, base: 8, keyR: 5, clear: 0.3, keyCount: 2, keyType: 'dome' });
  const owner = new Map(); let overlap = 0, inside = 0;
  const fr = r.parts.find((q) => q.kind === 'frame');
  r.parts.filter((p0) => p0.kind === 'plate').forEach((p0, k) => {
    const p = { ...p0, geometry: mergeGeometries([p0.geometry, fr.geometry]) };
    const g = p.geometry; g.computeBoundingBox();
    // mức đổ trong khung khay đã dịch: zFill = đáy + (rmax+4) + hTop
    const zFill = g.boundingBox.min.z + (r.rmax + 4) + r.fillHeight;
    const s = fill(p, zFill);
    if (s.pts) { const Me = new THREE.Matrix4().fromArray(p.frame.M), Mi = Me.clone().invert(), v = new THREE.Vector3(); for (const q of s.pts) { const i = q % s.nx, j = ((q / s.nx) | 0) % s.ny, kk = (q / (s.nx * s.ny)) | 0; v.set(g.boundingBox.min.x + (i - s.pad + 0.5) * vs + p.frame.shift[0], g.boundingBox.min.y + (j - s.pad + 0.5) * vs + p.frame.shift[1], g.boundingBox.min.z + (kk - s.pad + 0.5) * vs + p.frame.shift[2]).applyMatrix4(Mi); const key = Math.round(v.x / vs) + ',' + Math.round(v.y / vs) + ',' + Math.round(v.z / vs); if (owner.has(key) && owner.get(key) !== k) overlap++; else owner.set(key, k); inside++; } }
    console.log(`${name} khay ${k + 1}: ${s.err || `mô phỏng ${(s.vol / 1000).toFixed(0)} mL | tính toán ${(r.pieces[k].plasterMm3 / 1000).toFixed(0)} mL | rò: ${s.escaped ? 'CÓ' : 'không'}`}`);
  });
  console.log(`  ghép các mảnh: chồng lấn ${(overlap * vs ** 3 / 1000).toFixed(1)} mL trên ${(inside * vs ** 3 / 1000).toFixed(0)} mL`);
}
