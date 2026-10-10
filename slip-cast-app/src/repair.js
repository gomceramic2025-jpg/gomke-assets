// Vá lưới hở/không kín: chuyển sang khối voxel rồi dựng lại bề mặt kín (surface nets).
// Hố nhỏ hơn vài ô voxel được lấp tự động; chi tiết nhỏ hơn khoảng 1–2 voxel sẽ bị làm mượt.
import * as THREE from 'three';
import { meshVolume } from './mold.js';
import { MeshBVH } from 'three-mesh-bvh';

export function surfaceNets(occ, nx, ny, nz, vs, offsetFn, { blur = 2, smooth = 6, iso: isoLevel = 0.5 } = {}) {
  let f = Float32Array.from(occ);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  for (let it = 0; it < blur; it++) {
    const g = new Float32Array(f.length);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let sum = 0, n = 0;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj, kk = k + dk;
        if (ii >= 0 && ii < nx && jj >= 0 && jj < ny && kk >= 0 && kk < nz) sum += f[idx(ii, jj, kk)]; n++;
      }
      g[idx(i, j, k)] = sum / n;
    }
    f = g;
  }
  const iso = isoLevel, vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), pos = [];
  const cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corner.map(([a, b, c]) => f[idx(i + a, j + b, k + c)]);
    let mask = 0; v.forEach((x, q) => { if (x > iso) mask |= 1 << q; });
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] > iso) === (v[b] > iso)) continue;
      const t = (iso - v[a]) / (v[b] - v[a]);
      sx += corner[a][0] + (corner[b][0] - corner[a][0]) * t; sy += corner[a][1] + (corner[b][1] - corner[a][1]) * t; sz += corner[a][2] + (corner[b][2] - corner[a][2]) * t; n++;
    }
    vid[cid(i, j, k)] = pos.length / 3;
    pos.push(...offsetFn(i + sx / n, j + sy / n, k + sz / n));
  }
  const tri = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tri.push(a, c, b, a, d, c); else tri.push(a, b, c, a, c, d); };
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const here = f[idx(i, j, k)] > iso;
    // cạnh theo x, y, z từ đỉnh (i,j,k); bốn ô quanh cạnh phải nằm trong lưới
    if (j >= 1 && k >= 1 && here !== (f[idx(i + 1, j, k)] > iso)) quad(vid[cid(i, j - 1, k - 1)], vid[cid(i, j, k - 1)], vid[cid(i, j, k)], vid[cid(i, j - 1, k)], !here);
    if (i >= 1 && k >= 1 && here !== (f[idx(i, j + 1, k)] > iso)) quad(vid[cid(i - 1, j, k - 1)], vid[cid(i - 1, j, k)], vid[cid(i, j, k)], vid[cid(i, j, k - 1)], !here);
    if (i >= 1 && j >= 1 && here !== (f[idx(i, j, k + 1)] > iso)) quad(vid[cid(i - 1, j - 1, k)], vid[cid(i, j - 1, k)], vid[cid(i, j, k)], vid[cid(i - 1, j, k)], !here);
  }
  // làm mượt kiểu Taubin để bỏ bậc thang
  const nv = pos.length / 3, nb = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) { nb[tri[t + e]].add(tri[t + (e + 1) % 3]); nb[tri[t + e]].add(tri[t + (e + 2) % 3]); }
  let P = Float32Array.from(pos);
  const lap = (lam) => {
    const Q = Float32Array.from(P);
    for (let v = 0; v < nv; v++) { const s = nb[v]; if (!s.size) continue; let ax = 0, ay = 0, az = 0; for (const u of s) { ax += P[3 * u]; ay += P[3 * u + 1]; az += P[3 * u + 2]; } ax /= s.size; ay /= s.size; az /= s.size;
      Q[3 * v] += lam * (ax - P[3 * v]); Q[3 * v + 1] += lam * (ay - P[3 * v + 1]); Q[3 * v + 2] += lam * (az - P[3 * v + 2]); }
    P = Q;
  };
  for (let it = 0; it < smooth; it++) { lap(0.5); lap(-0.53); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(tri);
  g.computeVertexNormals();
  return g;
}


function dilate(a, nx, ny, nz) {
  const b = Uint8Array.from(a), idx = (i, j, k) => (k * ny + j) * nx + i;
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const p = idx(i, j, k);
    if (a[p] || a[p - 1] || a[p + 1] || a[p - nx] || a[p + nx] || a[p - nx * ny] || a[p + nx * ny]) b[p] = 1;
  }
  return b;
}
function erode(a, nx, ny, nz) {
  const b = new Uint8Array(a.length), idx = (i, j, k) => (k * ny + j) * nx + i;
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const p = idx(i, j, k);
    if (a[p] && a[p - 1] && a[p + 1] && a[p - nx] && a[p + nx] && a[p - nx * ny] && a[p + nx * ny]) b[p] = 1;
  }
  return b;
}

// Kéo từng đỉnh về điểm gần nhất trên bề mặt gốc: xóa bậc thang của voxel, trả lại đúng hình dạng.
// Chỉ kéo khi đủ gần và cùng hướng pháp tuyến (tránh dính sang mặt trong của vỏ mỏng); phần không có
// bề mặt gốc (chỗ bịt khoang rỗng) được làm mượt riêng.
function snapToSource(g, src, vs, onProgress) {
  onProgress('Vá lưới: bám sát bề mặt gốc...');
  const bvh = new MeshBVH(src, { indirect: true, maxLeafTris: 8 });
  const P = g.attributes.position, N = g.attributes.normal, n = P.count;
  const maxD = vs * 1.4, fixed = new Uint8Array(n), before = Float32Array.from(P.array);
  const ray = new THREE.Ray(), org = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    dir.set(-N.getX(i), -N.getY(i), -N.getZ(i)); // bắn từ ngoài vào trong
    org.set(P.getX(i) + N.getX(i) * maxD, P.getY(i) + N.getY(i) * maxD, P.getZ(i) + N.getZ(i) * maxD);
    ray.origin.copy(org); ray.direction.copy(dir);
    // chỉ nhận mặt quay ra phía tia (mặt ngoài của vỏ): mặt trong của vỏ mỏng không bị chọn nhầm
    const h = bvh.raycastFirst(ray, THREE.FrontSide, 0, maxD * 2);
    if (!h) continue;
    P.setXYZ(i, h.point.x, h.point.y, h.point.z); fixed[i] = 1;
  }
  // Lượt 2: đỉnh mà tia không trúng (chỗ lõm, chân tai): lấy điểm gần nhất nếu mặt đó cùng hướng với pháp tuyến
  const sp = src.attributes.position, six = src.index, tmp = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const v = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), fn = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (fixed[i]) continue;
    v.fromBufferAttribute(P, i);
    const h = bvh.closestPointToPoint(v, tmp, 0, vs * 2);
    if (!h) continue;
    const t = h.faceIndex;
    A.fromBufferAttribute(sp, six ? six.getX(3 * t) : 3 * t); B.fromBufferAttribute(sp, six ? six.getX(3 * t + 1) : 3 * t + 1); C.fromBufferAttribute(sp, six ? six.getX(3 * t + 2) : 3 * t + 2);
    fn.subVectors(B, A).cross(C.sub(A)).normalize(); nv.fromBufferAttribute(N, i);
    if (fn.dot(nv) < 0.5) continue;
    P.setXYZ(i, h.point.x, h.point.y, h.point.z); fixed[i] = 1;
  }
  // Bỏ các đỉnh làm gập mặt (pháp tuyến đảo so với trước khi bám): gập mặt làm phép cắt khuôn sau này bị bùng nổ
  const fidx = g.index.array, nf = fidx.length / 3, A2 = new THREE.Vector3(), B2 = new THREE.Vector3(), C2 = new THREE.Vector3(), n1 = new THREE.Vector3(), n0 = new THREE.Vector3();
  const triN = (arr, a, b, c, out) => { A2.set(arr[a * 3], arr[a * 3 + 1], arr[a * 3 + 2]); B2.set(arr[b * 3], arr[b * 3 + 1], arr[b * 3 + 2]); C2.set(arr[c * 3], arr[c * 3 + 1], arr[c * 3 + 2]); out.subVectors(B2, A2).cross(C2.sub(A2)); return out.length(); };
  for (let pass = 0; pass < 6; pass++) {
    let reverted = 0;
    for (let t = 0; t < nf; t++) {
      const a = fidx[3 * t], b = fidx[3 * t + 1], c = fidx[3 * t + 2];
      if (!fixed[a] && !fixed[b] && !fixed[c]) continue;
      const l1 = triN(P.array, a, b, c, n1), l0 = triN(before, a, b, c, n0);
      if (l0 < 1e-9) continue;
      // gập mặt (đảo hướng) hoặc co dẹt gần như về 0 so với ban đầu
      if (l1 < 1e-9 || n1.dot(n0) / (l1 * l0) < 0.35 || l1 < l0 * 0.08) {
        for (const v of [a, b, c]) if (fixed[v]) { P.setXYZ(v, before[v * 3], before[v * 3 + 1], before[v * 3 + 2]); fixed[v] = 0; reverted++; }
      }
    }
    if (!reverted) break;
  }
  // làm mượt phần chưa bám được (giữ nguyên các đỉnh đã bám)
  const idx = g.index.array, nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) nb[idx[t + e]].push(idx[t + (e + 1) % 3], idx[t + (e + 2) % 3]);
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < n; i++) {
      if (fixed[i] || !nb[i].length) continue;
      let x = 0, y = 0, z = 0; for (const j of nb[i]) { x += P.getX(j); y += P.getY(j); z += P.getZ(j); }
      const k = nb[i].length; P.setXYZ(i, P.getX(i) * 0.4 + 0.6 * x / k, P.getY(i) * 0.4 + 0.6 * y / k, P.getZ(i) * 0.4 + 0.6 * z / k);
    }
  }
  g.computeVertexNormals();
  let c = 0; for (let i = 0; i < n; i++) c += fixed[i];
  return c;
}

// Điền đầy theo độ che chắn: ô nào bị vỏ chắn ở ít nhất `need` trong 6 hướng (±x, ±y, ±z) thì coi là bên trong.
// Dùng cho vỏ rỗng hở một hai phía (mũ, cốc, vòm có cửa) mà cách đóng đáy phẳng không bịt kín được.
function occlusionFill(wall, nx, ny, nz, need) {
  const cnt = new Uint8Array(wall.length), st = [1, nx, nx * ny], len = [nx, ny, nz];
  for (let ax = 0; ax < 3; ax++) {
    const s1 = st[ax], n1 = len[ax], o1 = [0, 1, 2].filter((a) => a !== ax);
    for (let b = 0; b < len[o1[0]]; b++) for (let c = 0; c < len[o1[1]]; c++) {
      const base = b * st[o1[0]] + c * st[o1[1]];
      let seen = false;
      for (let t = 0; t < n1; t++) { const q = base + t * s1; if (seen) cnt[q]++; if (wall[q]) seen = true; }
      seen = false;
      for (let t = n1 - 1; t >= 0; t--) { const q = base + t * s1; if (seen) cnt[q]++; if (wall[q]) seen = true; }
    }
  }
  const occ = new Uint8Array(wall.length);
  for (let q = 0; q < occ.length; q++) occ[q] = wall[q] || cnt[q] >= need ? 1 : 0;
  return occ;
}

// geo: BufferGeometry (position + index tùy chọn). Trả về { geometry, voxel, close } hoặc ném lỗi.
export function repairMesh(geo, { res = 120, voxel = 0, snap = true, inset = 0.62, solid = false, caps = ['-z', '-y', '+z', '+y', '-x', '+x'], onProgress = () => {} } = {}) {
  const p = geo.attributes.position, ix = geo.index, nt = ix ? ix.count / 3 : p.count / 3;
  const bb = new THREE.Box3().setFromBufferAttribute(p), size = bb.getSize(new THREE.Vector3());
  if (voxel > 0) res = Math.min(320, Math.max(80, Math.max(size.x, size.y, size.z) / voxel));
  const vs = Math.max(size.x, size.y, size.z) / res, pad = 8;
  const nx = Math.ceil(size.x / vs) + 2 * pad, ny = Math.ceil(size.y / vs) + 2 * pad, nz = Math.ceil(size.z / vs) + 2 * pad;
  const ox = bb.min.x - pad * vs, oy = bb.min.y - pad * vs, oz = bb.min.z - pad * vs;
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  onProgress('Vá lưới: rải bề mặt lên khối voxel...');
  const surf = new Uint8Array(nx * ny * nz);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), step = vs * 0.5;
  for (let t = 0; t < nt; t++) {
    A.fromBufferAttribute(p, ix ? ix.getX(3 * t) : 3 * t); B.fromBufferAttribute(p, ix ? ix.getX(3 * t + 1) : 3 * t + 1); C.fromBufferAttribute(p, ix ? ix.getX(3 * t + 2) : 3 * t + 2);
    const L = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)), n = Math.max(1, Math.ceil(L / step));
    for (let a = 0; a <= n; a++) for (let b = 0; b <= n - a; b++) {
      const u = a / n, v = b / n, w = 1 - u - v;
      const i = Math.floor((A.x * w + B.x * u + C.x * v - ox) / vs), j = Math.floor((A.y * w + B.y * u + C.y * v - oy) / vs), k = Math.floor((A.z * w + B.z * u + C.z * v - oz) / vs);
      if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) surf[idx(i, j, k)] = 1;
    }
  }
  // Thử lần lượt: không đóng đáy, rồi (nếu cho phép) đóng đáy phẳng ở từng phía để điền đầy vật rỗng hở một đầu.
  // Với mỗi cách, tăng dần độ "đóng" cho tới khi phần trong không còn rò ra ngoài.
  const finish = (occ, close, cap) => {
    onProgress('Vá lưới: dựng lại bề mặt kín...');
    const g = surfaceNets(occ, nx, ny, nz, vs, (i, j, k) => [ox + i * vs, oy + j * vs, oz + k * vs], { blur: 1, smooth: 3 });
    if (meshVolume(g) < 0) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
    // Mặt voxel luôn nở ra khoảng nửa ô; thụt vào theo pháp tuyến để thể tích khớp bản gốc
    g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal;
    const ins = inset;
    for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) - N.getX(i) * ins * vs, P.getY(i) - N.getY(i) * ins * vs, P.getZ(i) - N.getZ(i) * ins * vs);
    g.computeVertexNormals();
    let snapped = 0;
    if (snap) snapped = snapToSource(g, geo, vs, onProgress);
    return { geometry: g, voxel: vs, close, cap, snapped: snapped / P.count };
  };
  const attempts = [{ cap: null }, ...(solid ? caps.map((c) => ({ cap: c })) : []), ...(solid ? [{ cap: null, occ: true }] : [])];
  const dims = [nx, ny, nz];
  const bboxVox = (nx - 2 * pad) * (ny - 2 * pad) * (nz - 2 * pad);
  for (const { cap, occ: byOcc } of attempts) {
    for (const close of byOcc ? [1] : [1, 2, 4, 6]) {
      onProgress(byOcc ? 'Vá lưới: điền đầy theo độ che chắn...' : cap ? `Vá lưới: đóng đáy ${cap} và điền đầy (mức ${close})...` : `Vá lưới: lấp lỗ (mức ${close})...`);
      let barrier = surf;
      for (let c = 0; c < close; c++) barrier = dilate(barrier, nx, ny, nz);
      if (byOcc) {
        let occ = occlusionFill(barrier, nx, ny, nz, 4);
        for (let c = 0; c < close; c++) occ = erode(occ, nx, ny, nz);
        return finish(occ, close, 'che-chan');
      }
      if (cap) {
        barrier = Uint8Array.from(barrier);
        const ax = 'xyz'.indexOf(cap[1]), layer = cap[0] === '-' ? pad - 1 : dims[ax] - pad;
        for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if ((ax === 0 ? i : ax === 1 ? j : k) === layer) barrier[idx(i, j, k)] = 1;
      }
      const ext = new Uint8Array(nx * ny * nz), stack = new Int32Array(nx * ny * nz);
      let sp = 0;
      // hạt giống: mọi ô nằm trên mặt biên của lưới (tấm đáy có thể chia lưới thành hai phía)
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) { const q = idx(i, j, k); if (!barrier[q] && !ext[q]) { ext[q] = 1; stack[sp++] = q; } }
      }
      while (sp) {
        const q = stack[--sp], i = q % nx, j = ((q / nx) | 0) % ny, k = (q / (nx * ny)) | 0;
        const push = (r) => { if (!ext[r] && !barrier[r]) { ext[r] = 1; stack[sp++] = r; } };
        if (i > 0) push(q - 1); if (i < nx - 1) push(q + 1); if (j > 0) push(q - nx); if (j < ny - 1) push(q + nx); if (k > 0) push(q - nx * ny); if (k < nz - 1) push(q + nx * ny);
      }
      let inner = 0;
      for (let q = 0; q < ext.length; q++) if (!ext[q] && !barrier[q]) inner++;
      if (inner < Math.max(20, cap ? bboxVox * 0.004 : 0)) continue; // vẫn rò: tăng mức đóng / thử cách khác
      let occ = new Uint8Array(ext.length);
      for (let q = 0; q < ext.length; q++) occ[q] = ext[q] ? 0 : 1;
      for (let c = 0; c < close; c++) occ = erode(occ, nx, ny, nz);
      return finish(occ, close, cap);
    }
  }
  throw new Error(solid ? 'Không dựng được khối đặc: mô hình không bao kín một khối kể cả khi đóng đáy phẳng. Hãy sửa trong Blender/Meshmixer (Make Manifold)' : 'Không vá được lưới: bề mặt có lỗ quá lớn hoặc là vỏ rỗng hở. Bật “Tự đóng đáy và điền đầy vật rỗng hở” hoặc sửa trong Blender/Meshmixer');
}
