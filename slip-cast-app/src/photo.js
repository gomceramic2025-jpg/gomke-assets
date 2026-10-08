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

export function reliefFromImage(img, { widthMm, depthMm, baseMm, invert = false, gamma = 1, blur = 1, cut = true, thr = null, gridW = 200 }) {
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
  return { hgt, gw, gh, geometry: reliefSolid(hgt, gw, gh, widthMm, depthMm, baseMm) };
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
