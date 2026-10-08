// Dựng phôi 3D từ ảnh 2D bằng thuật toán (không dùng AI tạo hình).
// Ảnh vào là {data: RGBA, width, height}. Đơn vị đầu ra: mm.
import * as THREE from 'three';
import { cleanGeometry } from './mold.js';

// ---------- Tách nền ----------

function median(arr) { const a = Float32Array.from(arr).sort(); return a[a.length >> 1]; }

// Khoảng cách màu của mỗi điểm so với màu nền (ước lượng từ viền ảnh).
export function colorDiff(img) {
  const { data, width: w, height: h } = img;
  const ring = [[], [], []];
  const take = (x, y) => { const i = (y * w + x) * 4; if (data[i + 3] >= 128) for (let c = 0; c < 3; c++) ring[c].push(data[i + c]); };
  const b = 2;
  for (let x = 0; x < w; x++) for (let k = 0; k < b; k++) { take(x, k); take(x, h - 1 - k); }
  for (let y = 0; y < h; y++) for (let k = 0; k < b; k++) { take(k, y); take(w - 1 - k, y); }
  const bg = ring[0].length ? ring.map(median) : [255, 255, 255];
  const d = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) { d[p] = 255; continue; } // vùng trong suốt = nền
    d[p] = Math.min(255, Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])));
  }
  // ảnh PNG trong suốt: nền = alpha thấp -> coi là khác nền (255) để tách ngược lại bên dưới
  const transparent = (() => { let n = 0; for (let p = 0; p < w * h; p += 7) if (data[p * 4 + 3] < 128) n++; return n > (w * h) / 7 * 0.05; })();
  if (transparent) for (let p = 0; p < w * h; p++) d[p] = data[p * 4 + 3] < 128 ? 0 : 255;
  return d;
}

export function otsu(d) {
  const hist = new Float64Array(256);
  for (let i = 0; i < d.length; i++) hist[d[i]]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wb = 0, sb = 0, best = 0, thr = 20;
  for (let t = 0; t < 256; t++) {
    wb += hist[t]; if (!wb) continue;
    const wf = d.length - wb; if (!wf) break;
    sb += t * hist[t];
    const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) * (mb - mf);
    if (v > best) { best = v; thr = t; }
  }
  return Math.max(8, thr);
}

// Mặt nạ vật thể: ngưỡng, lấp lỗ bên trong, giữ vùng liên thông lớn nhất.
export function makeMask(diff, w, h, thr) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = diff[i] > thr ? 1 : 0;
  // lấp lỗ: nền thật là vùng chạm viền ảnh
  const reach = new Uint8Array(w * h), st = [];
  const push = (x, y) => { const p = y * w + x; if (!m[p] && !reach[p]) { reach[p] = 1; st.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (st.length) {
    const p = st.pop(), x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y); if (x < w - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < h - 1) push(x, y + 1);
  }
  for (let i = 0; i < m.length; i++) if (!reach[i]) m[i] = 1;
  // giữ thành phần lớn nhất
  const lab = new Int32Array(w * h); let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < m.length; s++) {
    if (!m[s] || lab[s]) continue;
    id++; let n = 0; st.push(s); lab[s] = id;
    while (st.length) {
      const p = st.pop(); n++;
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) if (q >= 0 && m[q] && !lab[q]) { lab[q] = id; st.push(q); }
    }
    if (n > best) { best = n; bestId = id; }
  }
  for (let i = 0; i < m.length; i++) m[i] = lab[i] === bestId ? 1 : 0;
  return m;
}

// ---------- Tròn xoay: đường viền -> hồ sơ bán kính ----------

function smooth1d(a, win) {
  if (win < 2) return a;
  const out = new Float32Array(a.length), hw = win >> 1;
  for (let i = 0; i < a.length; i++) {
    let s = 0, n = 0;
    for (let k = -hw; k <= hw; k++) { const j = i + k; if (j >= 0 && j < a.length) { s += a[j]; n++; } }
    out[i] = s / n;
  }
  return out;
}

// side: 'both' | 'left' | 'right'. heightMm: chiều cao thật của vật.
export function extractProfile(mask, w, h, { heightMm, side = 'both', smooth = 5, n = 240 }) {
  let y0 = -1, y1 = -1;
  const L = new Int32Array(h).fill(-1), R = new Int32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (mask[y * w + x]) { L[y] = x; break; }
    for (let x = w - 1; x >= 0; x--) if (mask[y * w + x]) { R[y] = x; break; }
    if (L[y] >= 0) { if (y0 < 0) y0 = y; y1 = y; }
  }
  if (y0 < 0) throw new Error('Không tìm thấy vật thể. Hãy chỉnh “Độ nhạy tách nền”.');
  const rows = y1 - y0 + 1;
  const mids = [];
  for (let y = y0 + Math.floor(rows * 0.05); y <= y1 - Math.floor(rows * 0.05); y++) if (L[y] >= 0) mids.push((L[y] + R[y] + 1) / 2);
  const xc = mids.length ? median(mids) : (L[y0] + R[y0]) / 2;
  const scale = heightMm / rows; // mm / pixel
  const pxR = new Float32Array(n), ys = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const yy = y1 - (i / (n - 1)) * (rows - 1); // i = 0 là đáy
    const yi = Math.round(yy);
    let r;
    if (L[yi] < 0) r = 0;
    else if (side === 'left') r = xc - L[yi];
    else if (side === 'right') r = R[yi] + 1 - xc;
    else r = (R[yi] + 1 - L[yi]) / 2;
    pxR[i] = Math.max(0, r); ys[i] = yy;
  }
  const sm = smooth1d(pxR, smooth);
  sm[0] = pxR[0]; sm[n - 1] = pxR[n - 1]; // giữ nguyên bán kính ở đáy và miệng
  return { r: Float32Array.from(sm, (v) => Math.max(0.2, v * scale)), y: Float32Array.from(ys, (v) => (y1 - v) * scale), px: sm, ys, xc, y0, y1, scale, width: (R.reduce((m, v) => Math.max(m, v), 0) - L.filter((v) => v >= 0).reduce((m, v) => Math.min(m, v), 1e9)) * scale };
}

export function latheFromProfile(prof, segments = 160) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i < prof.r.length; i++) pts.push(new THREE.Vector2(prof.r[i], prof.y[i]));
  pts.push(new THREE.Vector2(0, prof.y[prof.y.length - 1]));
  return cleanGeometry(new THREE.LatheGeometry(pts, segments));
}

// Độ khớp đường viền (IoU) giữa mặt nạ ảnh và hình chiếu của mô hình xoay.
export function profileIoU(mask, w, prof) {
  let inter = 0, uni = 0;
  for (let y = prof.y0; y <= prof.y1; y++) {
    const t = (prof.y1 - y) / Math.max(1, prof.y1 - prof.y0);
    const f = t * (prof.px.length - 1), i = Math.min(prof.px.length - 2, Math.floor(f)), k = f - i;
    const r = prof.px[i] * (1 - k) + prof.px[i + 1] * k;
    const a = Math.round(prof.xc - r), b = Math.round(prof.xc + r);
    for (let x = 0; x < w; x++) {
      const m = mask[y * w + x] === 1, o = x >= a && x < b;
      if (m && o) inter++; if (m || o) uni++;
    }
  }
  return uni ? inter / uni : 0;
}

// ---------- Phù điêu: độ sáng -> độ cao ----------

export function reliefFromImage(img, { widthMm, depthMm, baseMm, invert = false, gamma = 1, blur = 1, cut = true, thr = null, gridW = 200, minDraft = 5, fix = false }) {
  const { data, width: w, height: h } = img;
  const gw = Math.min(gridW, w), gh = Math.max(2, Math.round((gw * h) / w));
  const gray = new Float32Array(gw * gh), cnt = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = Math.min(gw - 1, Math.floor((x * gw) / w)), gy = Math.min(gh - 1, Math.floor((y * gh) / h)), i = (y * w + x) * 4;
    gray[gy * gw + gx] += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; cnt[gy * gw + gx]++;
  }
  for (let i = 0; i < gray.length; i++) gray[i] /= cnt[i] || 1;
  // vùng vật thể: để nền phẳng ở độ cao 0
  let sub = null;
  if (cut) {
    const diff = colorDiff(img), t = thr == null ? otsu(diff) : thr, m = makeMask(diff, w, h, t);
    sub = new Uint8Array(gw * gh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) sub[Math.min(gh - 1, Math.floor((y * gh) / h)) * gw + Math.min(gw - 1, Math.floor((x * gw) / w))] = 1;
  }
  const vals = [];
  for (let i = 0; i < gray.length; i++) if (!sub || sub[i]) vals.push(gray[i]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)] ?? 0, hi = vals[Math.floor(vals.length * 0.98)] ?? 255;
  let hgt = new Float32Array(gw * gh);
  for (let i = 0; i < hgt.length; i++) {
    let v = Math.min(1, Math.max(0, (gray[i] - lo) / Math.max(1, hi - lo)));
    if (invert) v = 1 - v;
    hgt[i] = sub && !sub[i] ? 0 : Math.pow(v, gamma);
  }
  for (let it = 0; it < Math.round(blur) * 2; it++) { // làm mượt
    const nx = new Float32Array(hgt.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < gw && yy >= 0 && yy < gh) { s += hgt[yy * gw + xx]; n++; } }
      nx[y * gw + x] = s / n;
    }
    hgt = nx;
  }
  const draft0 = reliefDraft(hgt, gw, gh, widthMm, depthMm, minDraft);
  if (fix) hgt = limitSlope(hgt, gw, gh, widthMm, depthMm, minDraft);
  const draft1 = fix ? reliefDraft(hgt, gw, gh, widthMm, depthMm, minDraft) : draft0;
  return { hgt, gw, gh, draft0, draft1, geometry: reliefSolid(hgt, gw, gh, widthMm, depthMm, baseMm) };
}

// Khối kín: mặt trên theo độ cao, đáy phẳng, thành bao quanh.
function reliefSolid(hgt, gw, gh, widthMm, depthMm, baseMm) {
  const sx = widthMm / (gw - 1), pos = [], idx = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) pos.push(x * sx, baseMm + hgt[(gh - 1 - y) * gw + x] * depthMm, y * sx);
  // trục: x = ngang, y = cao (độ nổi), z = dọc ảnh. Mặt trên quay lên +y.
  for (let y = 0; y < gh - 1; y++) for (let x = 0; x < gw - 1; x++) {
    const a = y * gw + x, b = a + 1, c = a + gw, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const ring = [];
  for (let x = 0; x < gw; x++) ring.push(x);
  for (let y = 1; y < gh; y++) ring.push(y * gw + gw - 1);
  for (let x = gw - 2; x >= 0; x--) ring.push((gh - 1) * gw + x);
  for (let y = gh - 2; y >= 1; y--) ring.push(y * gw);
  const base = pos.length / 3, nr = ring.length;
  for (const v of ring) pos.push(pos[v * 3], 0, pos[v * 3 + 2]);
  for (let i = 0; i < nr; i++) { const j = (i + 1) % nr; idx.push(ring[i], ring[j], base + i, ring[j], base + j, base + i); }
  const cx = pos.length / 3; pos.push(widthMm / 2, 0, ((gh - 1) * sx) / 2);
  for (let i = 0; i < nr; i++) idx.push(cx, base + i, base + ((i + 1) % nr));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return cleanGeometry(g);
}

// ======================================================================
// 1) NHIỀU ẢNH QUANH VẬT (đặt trên bàn xoay): khối giao các hình chiếu (visual hull)
// ======================================================================

// views: [{ mask, w, h, angleDeg }]. Giả định máy ảnh cố định, quay bàn xoay đều, ảnh gần như chiếu song song.
export function carveHull(views, { heightMm, res = 128, flip = false }) {
  const boxes = views.map((v) => {
    let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < v.h; y++) for (let x = 0; x < v.w; x++) if (v.mask[y * v.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) throw new Error('Có ảnh không tìm thấy vật thể. Hãy chỉnh “Độ nhạy tách nền”.');
    return { x0, x1, y0, y1 };
  });
  const hpx = boxes.reduce((s, b) => s + (b.y1 - b.y0 + 1), 0) / boxes.length;
  const ppm = hpx / heightMm; // pixel / mm
  const xc = boxes.reduce((s, b) => s + (b.x0 + b.x1 + 1) / 2, 0) / boxes.length;
  const R = Math.max(...boxes.map((b) => Math.max(xc - b.x0, b.x1 + 1 - xc))) / ppm * 1.04;
  const Hm = heightMm * 1.02;
  const vs = Math.max(2 * R, Hm) / res;
  const nx = Math.ceil((2 * R) / vs) + 2, ny = Math.ceil(Hm / vs) + 2, nz = nx;
  const occ = new Uint8Array(nx * ny * nz).fill(1);
  const sg = flip ? -1 : 1;
  views.forEach((v, vi) => {
    const th = (sg * v.angleDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), b = boxes[vi];
    for (let k = 0; k < nz; k++) {
      const z = (k - nz / 2 + 0.5) * vs;
      for (let i = 0; i < nx; i++) {
        const x = (i - nx / 2 + 0.5) * vs, sx = x * c + z * s, col = Math.round(xc + sx * ppm - 0.5);
        for (let j = 0; j < ny; j++) {
          const p = (k * ny + j) * nx + i;
          if (!occ[p]) continue;
          const row = Math.round(b.y1 + 0.5 - ((j - 0.5) * vs) * ppm);
          if (col < 0 || col >= v.w || row < 0 || row >= v.h || !v.mask[row * v.w + col]) occ[p] = 0;
        }
      }
    }
  });
  // độ khớp: chiếu khối vừa dựng lại về từng ảnh
  const ious = views.map((v, vi) => {
    const th = (sg * v.angleDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), b = boxes[vi];
    const proj = new Uint8Array(v.w * v.h);
    for (let k = 0; k < nz; k++) { const z = (k - nz / 2 + 0.5) * vs;
      for (let i = 0; i < nx; i++) { const x = (i - nx / 2 + 0.5) * vs, col = Math.round(xc + (x * c + z * s) * ppm - 0.5);
        for (let j = 0; j < ny; j++) if (occ[(k * ny + j) * nx + i]) {
          const row = Math.round(b.y1 + 0.5 - ((j - 0.5) * vs) * ppm), hw = Math.ceil((vs * ppm) / 2);
          for (let yy = Math.max(0, row - hw); yy <= Math.min(v.h - 1, row + hw); yy++) for (let xx = Math.max(0, col - hw); xx <= Math.min(v.w - 1, col + hw); xx++) proj[yy * v.w + xx] = 1;
        } } }
    let inter = 0, uni = 0;
    for (let p = 0; p < proj.length; p++) { const m = v.mask[p] === 1, q = proj[p] === 1; if (m && q) inter++; if (m || q) uni++; }
    return uni ? inter / uni : 0;
  });
  return { occ, nx, ny, nz, vs, R, H: Hm, ppm, xc, ious };
}

// Làm mượt chiếm chỗ rồi lấy mặt đẳng trị bằng "surface nets" (kín, đều đặn).
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

export function hullGeometry(h, opts) {
  const geo = surfaceNets(h.occ, h.nx, h.ny, h.nz, h.vs, (i, j, k) => [(i - h.nx / 2 + 0.5) * h.vs, (j - 0.5) * h.vs, (k - h.nz / 2 + 0.5) * h.vs], opts);
  if (meshVolumeSigned(geo) < 0) { const a = geo.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } geo.index.needsUpdate = true; geo.computeVertexNormals(); }
  return geo;
}
function meshVolumeSigned(g) {
  const p = g.attributes.position, ix = g.index.array; let v = 0;
  for (let i = 0; i < ix.length; i += 3) { const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
    v += (p.array[a] * (p.array[b + 1] * p.array[c + 2] - p.array[b + 2] * p.array[c + 1]) - p.array[a + 1] * (p.array[b] * p.array[c + 2] - p.array[b + 2] * p.array[c]) + p.array[a + 2] * (p.array[b] * p.array[c + 1] - p.array[b + 1] * p.array[c])) / 6; }
  return v;
}

// ======================================================================
// 2) KHUÔN PHÙ ĐIÊU (một mảnh, mở mặt): góc thoát + hộp đổ in 3D
// ======================================================================

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { meshVolume } from './mold.js';

// Tỉ lệ diện tích có góc thoát nhỏ hơn minDraftDeg (so với phương kéo đứng) và góc thoát nhỏ nhất.
export function reliefDraft(hgt, gw, gh, widthMm, depthMm, minDraftDeg = 3) {
  const sx = widthMm / (gw - 1), lim = 1 / Math.tan((minDraftDeg * Math.PI) / 180);
  let bad = 0, n = 0, maxG = 0;
  const flag = new Uint8Array(gw * gh);
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const c = hgt[y * gw + x];
    const gx = (Math.max(Math.abs(hgt[y * gw + x + 1] - c), Math.abs(c - hgt[y * gw + x - 1])) * depthMm) / sx;
    const gy = (Math.max(Math.abs(hgt[(y + 1) * gw + x] - c), Math.abs(c - hgt[(y - 1) * gw + x])) * depthMm) / sx;
    const g = Math.max(gx, gy); maxG = Math.max(maxG, g); n++;
    if (g > lim * 1.002) { bad++; flag[y * gw + x] = 1; }
  }
  return { badFrac: n ? bad / n : 0, minDraft: 90 - (Math.atan(maxG) * 180) / Math.PI, flag };
}

// Cắt dốc: sườn không dốc quá giới hạn (tạo góc thoát), hạ phần đỉnh sát vách đứng.
export function limitSlope(hgt, gw, gh, widthMm, depthMm, minDraftDeg) {
  const sx = widthMm / (gw - 1), a = (sx / depthMm) / Math.tan((minDraftDeg * Math.PI) / 180), b = a * 1.4142;
  const h = Float32Array.from(hgt);
  const at = (x, y) => h[y * gw + x];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let v = h[y * gw + x];
    if (x > 0) v = Math.min(v, at(x - 1, y) + a);
    if (y > 0) { v = Math.min(v, at(x, y - 1) + a); if (x > 0) v = Math.min(v, at(x - 1, y - 1) + b); if (x < gw - 1) v = Math.min(v, at(x + 1, y - 1) + b); }
    h[y * gw + x] = v;
  }
  for (let y = gh - 1; y >= 0; y--) for (let x = gw - 1; x >= 0; x--) {
    let v = h[y * gw + x];
    if (x < gw - 1) v = Math.min(v, at(x + 1, y) + a);
    if (y < gh - 1) { v = Math.min(v, at(x, y + 1) + a); if (x < gw - 1) v = Math.min(v, at(x + 1, y + 1) + b); if (x > 0) v = Math.min(v, at(x - 1, y + 1) + b); }
    h[y * gw + x] = v;
  }
  return h;
}

// Hộp đổ: khay có sẵn phôi phù điêu nằm trên sàn. Đổ thạch cao tới mép tường, tháo ra là khuôn lõm.
export function reliefMold(plaque, { margin, plasterTop, wall, floor }) {
  const g = plaque.clone(); g.computeBoundingBox();
  const bb = g.boundingBox, W = bb.max.x - bb.min.x, D = bb.max.z - bb.min.z, topY = bb.max.y + plasterTop;
  g.translate(-bb.min.x, -1, -bb.min.z); // chìm 1 mm vào sàn để các khối dính liền
  const box = (x0, x1, y0, y1, z0, z1) => { const b = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); b.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); b.deleteAttribute('uv'); return b.toNonIndexed(); };
  const m = margin, w = wall, y0 = -floor;
  const parts = [
    box(-m - w, W + m + w, y0, 0, -m - w, D + m + w),
    box(-m - w, -m, y0, topY, -m - w, D + m + w), box(W + m, W + m + w, y0, topY, -m - w, D + m + w),
    box(-m, W + m, y0, topY, -m - w, -m), box(-m, W + m, y0, topY, D + m, D + m + w),
  ];
  const ng = g.toNonIndexed(); ng.deleteAttribute('uv');
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  parts.push(ng);
  const merged = mergeGeometries(parts.map((p) => { for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k); return p; }));
  merged.translate(0, floor, 0);
  const plaqueVol = Math.abs(meshVolume(plaque));
  return { geometry: merged, plasterMm3: (W + 2 * m) * (D + 2 * m) * (topY) - plaqueVol, size: [W + 2 * (m + w), topY + floor, D + 2 * (m + w)], topY };
}

// ======================================================================
// 3) HOA VĂN NỔI TRÊN THÂN TRÒN XOAY
// ======================================================================

const sstep = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

function sampleGray(img, u, v) { // bilinear, u lặp lại, v kẹp
  const x = (((u % 1) + 1) % 1) * img.w, y = Math.min(1, Math.max(0, v)) * (img.h - 1);
  const x0 = Math.floor(x) % img.w, x1 = (x0 + 1) % img.w, y0 = Math.floor(y), y1 = Math.min(img.h - 1, y0 + 1), tx = x - Math.floor(x), ty = y - y0;
  const g = img.gray;
  return (g[y0 * img.w + x0] * (1 - tx) + g[y0 * img.w + x1] * tx) * (1 - ty) + (g[y1 * img.w + x0] * (1 - tx) + g[y1 * img.w + x1] * tx) * ty;
}

// Chuyển ảnh thành bản đồ xám 0..1 (cân bằng 2%–98%).
export function grayMap(img, { invert = false, gamma = 1 } = {}) {
  const { data, width: w, height: h } = img, g = new Float32Array(w * h), v = [];
  for (let i = 0; i < w * h; i++) { g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; v.push(g[i]); }
  v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)];
  for (let i = 0; i < g.length; i++) { let t = Math.min(1, Math.max(0, (g[i] - lo) / Math.max(1, hi - lo))); if (invert) t = 1 - t; g[i] = Math.pow(t, gamma); }
  return { gray: g, w, h };
}

// pat: { kind: 'flutes'|'image', count, depth, twist, sharp, y0, y1, taper, img, repeat }
export function latheEmboss(prof, pat, { segments = 192, rows = 240 } = {}) {
  const n = prof.r.length, H = prof.y[n - 1] - prof.y[0], y00 = prof.y[0];
  const rAtY = (y) => { const f = ((y - y00) / H) * (n - 1), i = Math.max(0, Math.min(n - 2, Math.floor(f))), t = f - i; return prof.r[i] * (1 - t) + prof.r[i + 1] * t; };
  const pos = [], idx = [];
  for (let j = 0; j < rows; j++) {
    const yf = j / (rows - 1), y = y00 + yf * H, r0 = rAtY(y);
    const win = pat.kind === 'none' ? 0 : sstep((yf - pat.y0) / pat.taper) * sstep((pat.y1 - yf) / pat.taper);
    const vv = (yf - pat.y0) / Math.max(1e-6, pat.y1 - pat.y0);
    for (let i = 0; i < segments; i++) {
      const a = (2 * Math.PI * i) / segments;
      let d = 0;
      if (win > 0) {
        if (pat.kind === 'flutes') d = pat.depth * Math.pow((1 + Math.cos(pat.count * (a - pat.twist * 2 * Math.PI * vv))) / 2, pat.sharp);
        else if (pat.kind === 'image' && pat.img) d = pat.depth * sampleGray(pat.img, (a / (2 * Math.PI)) * pat.repeat, 1 - vv);
        d *= win;
      }
      const r = Math.max(0.2, r0 + d);
      pos.push(r * Math.cos(a), y, r * Math.sin(a));
    }
  }
  const bot = pos.length / 3; pos.push(0, y00, 0);
  const top = bot + 1; pos.push(0, y00 + H, 0);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * segments + i, b = j * segments + ((i + 1) % segments), c = (j + 1) * segments + i, d = (j + 1) * segments + ((i + 1) % segments);
    idx.push(a, b, c, b, d, c);
  }
  const o = (rows - 1) * segments;
  for (let i = 0; i < segments; i++) { idx.push(bot, (i + 1) % segments, i); idx.push(top, o + i, o + ((i + 1) % segments)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (meshVolume(g) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.index.needsUpdate = true; }
  g.computeVertexNormals();
  return g;
}
