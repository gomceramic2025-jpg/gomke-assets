// Mô phỏng đổ thạch cao: đánh dấu bề mặt các chi tiết in thành "tường", rồi cho thạch cao tràn từ trên xuống ở từng mảnh.
import * as THREE from 'three';
import { orientPhoi, phoiStats } from '../src/mold.js';
import { buildShell } from '../src/shell.js';
import { twistedVase } from '../src/sample.js';
const ph = orientPhoi(twistedVase(), { shrink: 0.12 });
const st = phoiStats(ph);
let rBot = 0; { const p = ph.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 1) rBot = Math.max(rBot, Math.hypot(p.getX(i), p.getZ(i))); }
function simulate(parts, o, r) {
  const vs = 0.7, R = r.dims.D / 2 + 6, ny = Math.ceil((r.yTop + 2) / vs), nx = Math.ceil((2 * R) / vs), nz = nx;
  const wall = new Uint8Array(nx * ny * nz), idx = (i, j, k) => (k * ny + j) * nx + i;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (const part of parts) {
    const p = part.geometry.attributes.position, ix = part.geometry.index, nt = ix ? ix.count / 3 : p.count / 3;
    for (let t = 0; t < nt; t++) {
      A.fromBufferAttribute(p, ix ? ix.getX(3 * t) : 3 * t); B.fromBufferAttribute(p, ix ? ix.getX(3 * t + 1) : 3 * t + 1); C.fromBufferAttribute(p, ix ? ix.getX(3 * t + 2) : 3 * t + 2);
      const L = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)), n = Math.max(1, Math.ceil(L / (vs * 0.45)));
      for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) { const u = a / n, v = b / n, w = 1 - u - v;
        const x = A.x * w + B.x * u + C.x * v, y = A.y * w + B.y * u + C.y * v, z = A.z * w + B.z * u + C.z * v;
        const i = Math.floor((x + R) / vs), j = Math.floor(y / vs), k = Math.floor((z + R) / vs);
        if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) wall[idx(i, j, k)] = 1; } }
  }
  const flood = (sx, sy, sz) => {
    const seen = new Uint8Array(wall.length), st = [idx(Math.floor((sx + R) / vs), Math.floor(sy / vs), Math.floor((sz + R) / vs))];
    if (wall[st[0]]) return null; seen[st[0]] = 1; let cnt = 0;
    while (st.length) { const q = st.pop(); cnt++; const i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
      const go = (qq) => { if (!seen[qq] && !wall[qq]) { seen[qq] = 1; st.push(qq); } };
      if (i > 0) go(q - 1); if (i < nx - 1) go(q + 1); if (j > 0) go(q - nx); if (j < ny - 1) go(q + nx); if (k > 0) go(q - nx * ny); if (k < nz - 1) go(q + nx * ny); }
    return { seen, cnt };
  };
  return { flood, vs, R, nx, ny, nz, idx };
}
const base = { wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 14, base: 20, keyR: 5, clear: 0.3, keyCount: 2 };
for (const type of ['none', 'ball', 'dome']) {
  const o = { ...base, angles: [0, 180], keyType: type }; const r = buildShell(ph, o);
  const sim = simulate(r.parts.filter((p) => p.kind !== 'key'), o, r);
  const y = r.yTop - 6, rs = rBot + 6;
  const fa = sim.flood(0, y, rs), fb = sim.flood(0, y, -rs);   // mảnh z>0 và mảnh z<0
  if (!fa || !fb) { console.log(type, 'hạt giống nằm trong tường?', !!fa, !!fb); continue; }
  const leak = fa.seen[sim.idx(Math.floor((0 + sim.R) / sim.vs), Math.floor(y / sim.vs), Math.floor((-rs + sim.R) / sim.vs))] === 1;
  // đếm voxel của mỗi bên nằm sang phía bên kia mặt phẳng chia (z) quá 0,9 mm: chính là phần chốt lồi
  let aOver = 0, bOver = 0; const half = sim.nz;
  for (let k = 0; k < sim.nz; k++) { const z = k * sim.vs - sim.R; for (let j = 0; j < sim.ny; j++) for (let i = 0; i < sim.nx; i++) { const q = sim.idx(i, j, k);
    if (fa.seen[q] && z < -0.9) aOver++; if (fb.seen[q] && z > 0.9) bOver++; } }
  console.log(`${type}: thạch cao A=${(fa.cnt * sim.vs ** 3 / 1e6).toFixed(2)} L, B=${(fb.cnt * sim.vs ** 3 / 1e6).toFixed(2)} L | A rò sang B: ${leak ? 'CÓ (lỗi)' : 'không'} | chốt lồi: A sang phía B ${aOver} voxel, B sang phía A ${bOver} voxel`);
}
