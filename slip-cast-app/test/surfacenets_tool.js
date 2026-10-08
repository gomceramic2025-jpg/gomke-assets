import * as THREE from 'three';
export function surfaceNets(occ, nx, ny, nz, vs, offsetFn, { blur = 2, smooth = 6 } = {}) {
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
  const iso = 0.5, vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), pos = [];
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

