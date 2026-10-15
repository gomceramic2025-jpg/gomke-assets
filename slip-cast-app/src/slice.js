// Vách chia dựng từ lát cắt chính xác của phôi (không dùng phép trừ CSG với lưới phôi).
// Chi phí và chất lượng không phụ thuộc số mặt của phôi: phôi vài triệu mặt vẫn cho đường viền mượt.
// Mặt phẳng vách đi qua trục Y, hướng ra ngoài d = (cos a, 0, sin a), pháp tuyến n = (-sin a, 0, cos a).
import * as THREE from 'three';

// Giao của các tam giác với mặt phẳng n·p = off, trả về các đoạn (u0,y0,u1,y1) với u = d·p
function planeSegments(g, a, off) {
  const p = g.attributes.position.array, ix = g.index ? g.index.array : null;
  const nt = (ix ? ix.length : p.length / 3) / 3;
  const dx = Math.cos(a), dz = Math.sin(a), nx = -dz, nz = dx;
  const out = [];
  const px = [0, 0, 0], py = [0, 0, 0], pu = [0, 0, 0], ps = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const v = (ix ? ix[3 * t + k] : 3 * t + k) * 3;
      const x = p[v], y = p[v + 1], z = p[v + 2];
      pu[k] = x * dx + z * dz; py[k] = y; ps[k] = x * nx + z * nz - off;
    }
    const s0 = ps[0] >= 0, s1 = ps[1] >= 0, s2 = ps[2] >= 0;
    if (s0 === s1 && s1 === s2) continue;
    const pts = [];
    for (let k = 0; k < 3; k++) {
      const l = (k + 1) % 3;
      if ((ps[k] >= 0) !== (ps[l] >= 0)) {
        const f = ps[k] / (ps[k] - ps[l]);
        pts.push(pu[k] + (pu[l] - pu[k]) * f, py[k] + (py[l] - py[k]) * f);
      }
    }
    if (pts.length === 4) out.push(pts[0], pts[1], pts[2], pts[3]);
  }
  void px;
  return Float32Array.from(out);
}

// Điền các ô nằm trong phôi theo quy tắc chẵn-lẻ trên từng hàng (cộng dồn vào occ)
function fillFromSegments(seg, occ, W, H, h, u0, y0) {
  const cnt = new Int32Array(H + 1);
  const rowRange = (ya, yb) => {
    const lo = Math.max(0, Math.ceil((Math.min(ya, yb) - y0) / h - 0.5)), hi = Math.min(H - 1, Math.floor((Math.max(ya, yb) - y0) / h - 0.5));
    return [lo, hi];
  };
  for (let s = 0; s < seg.length; s += 4) {
    if (seg[s + 1] === seg[s + 3]) continue;
    const [lo, hi] = rowRange(seg[s + 1], seg[s + 3]);
    for (let j = lo; j <= hi; j++) cnt[j + 1]++;
  }
  for (let j = 0; j < H; j++) cnt[j + 1] += cnt[j];
  const xs = new Float32Array(cnt[H]), fill = Int32Array.from(cnt);
  for (let s = 0; s < seg.length; s += 4) {
    const ua = seg[s], ya = seg[s + 1], ub = seg[s + 2], yb = seg[s + 3];
    if (ya === yb) continue;
    const [lo, hi] = rowRange(ya, yb);
    for (let j = lo; j <= hi; j++) {
      const yc = y0 + (j + 0.5) * h;
      xs[fill[j]++] = ua + ((ub - ua) * (yc - ya)) / (yb - ya);
    }
  }
  for (let j = 0; j < H; j++) {
    const row = xs.subarray(cnt[j], cnt[j + 1]);
    if (row.length < 2) continue;
    row.sort();
    for (let k = 0; k + 1 < row.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((row[k] - u0) / h - 0.5)), i1 = Math.min(W - 1, Math.floor((row[k + 1] - u0) / h - 0.5));
      for (let i = i0; i <= i1; i++) occ[j * W + i] = 1;
    }
  }
}

// Bỏ các mảnh rời quá nhỏ (vụn do lưới)
function dropSmall(reg, W, H, minCells) {
  const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!reg[s] || seen[s]) continue;
    let sp = 0, n = 0; const members = [];
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const q = stack[--sp]; n++; members.push(q);
      const i = q % W, j = (q / W) | 0;
      if (i > 0 && reg[q - 1] && !seen[q - 1]) { seen[q - 1] = 1; stack[sp++] = q - 1; }
      if (i < W - 1 && reg[q + 1] && !seen[q + 1]) { seen[q + 1] = 1; stack[sp++] = q + 1; }
      if (j > 0 && reg[q - W] && !seen[q - W]) { seen[q - W] = 1; stack[sp++] = q - W; }
      if (j < H - 1 && reg[q + W] && !seen[q + W]) { seen[q + W] = 1; stack[sp++] = q + W; }
    }
    if (n < minCells) for (const q of members) reg[q] = 0;
  }
}

// Đường viền các ô được điền: danh sách vòng kín (mảng [x,y] theo chỉ số đỉnh lưới), vùng nằm bên trái
function traceLoops(reg, W, H) {
  const NV = (W + 1) * (H + 1), vid = (i, j) => j * (W + 1) + i;
  const outA = new Int32Array(NV).fill(-1), outB = new Int32Array(NV).fill(-1);
  const add = (a, b) => { if (outA[a] < 0) outA[a] = b; else outB[a] = b; };
  const f = (i, j) => (i >= 0 && i < W && j >= 0 && j < H ? reg[j * W + i] : 0);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!reg[j * W + i]) continue;
    if (!f(i, j - 1)) add(vid(i, j), vid(i + 1, j));
    if (!f(i + 1, j)) add(vid(i + 1, j), vid(i + 1, j + 1));
    if (!f(i, j + 1)) add(vid(i + 1, j + 1), vid(i, j + 1));
    if (!f(i - 1, j)) add(vid(i, j + 1), vid(i, j));
  }
  const loops = [];
  for (let s = 0; s < NV; s++) {
    while (outA[s] >= 0 || outB[s] >= 0) {
      const pts = [];
      let cur = s, prev = -1;
      for (;;) {
        pts.push(cur);
        let nxt;
        if (outB[cur] >= 0) { // nút thắt: rẽ trái để các vòng không dính nhau
          const ix = cur % (W + 1), jy = (cur / (W + 1)) | 0;
          const pi = prev % (W + 1), pj = (prev / (W + 1)) | 0;
          const din = [ix - pi, jy - pj];
          const turn = (t) => { const tx = t % (W + 1) - ix, ty = ((t / (W + 1)) | 0) - jy; return din[0] * ty - din[1] * tx; };
          if (turn(outA[cur]) >= turn(outB[cur])) { nxt = outA[cur]; outA[cur] = outB[cur]; outB[cur] = -1; } else { nxt = outB[cur]; outB[cur] = -1; }
        } else { nxt = outA[cur]; outA[cur] = -1; }
        if (nxt < 0) break;
        prev = cur; cur = nxt;
        if (cur === s) break;
      }
      loops.push(pts.map((v) => [v % (W + 1), (v / (W + 1)) | 0]));
    }
  }
  return loops;
}

const area2 = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };

// Làm mượt bậc thang: trung bình với hai đỉnh kề (λ) rồi giãn ngược (μ) để không co hình; đoạn thẳng không đổi
function taubin(P, iters) {
  let cur = P.map((q) => [q[0], q[1]]);
  const n = cur.length;
  for (let it = 0; it < iters; it++) {
    for (const f of [0.5, -0.53]) {
      const nxt = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = cur[(i + n - 1) % n], b = cur[i], c = cur[(i + 1) % n];
        nxt[i] = [b[0] + f * ((a[0] + c[0]) / 2 - b[0]), b[1] + f * ((a[1] + c[1]) / 2 - b[1])];
      }
      cur = nxt;
    }
  }
  return cur;
}

function simplifyClosed(P, tol) {
  if (P.length < 8) return P;
  let ia = 0, ib = 0, best = -1;
  for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > best) { best = d; ib = i; } }
  const keep = new Uint8Array(P.length); keep[ia] = 1; keep[ib] = 1;
  const stack = [[ia, ib], [ib, P.length]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const A = P[s], B = P[e % P.length], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9;
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) { const d = Math.abs((P[i][0] - A[0]) * dy - (P[i][1] - A[1]) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return P.filter((_, i) => keep[i]);
}

const inPoly = (pt, P) => {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i].y > pt.y) !== (P[j].y > pt.y) && pt.x < ((P[j].x - P[i].x) * (pt.y - P[i].y)) / (P[j].y - P[i].y) + P[i].x) c = !c;
  }
  return c;
};

// o: { a (độ), td, y0, y1, offsets, limitR(y), sprue:{R,h}|null }
// Trả về BufferGeometry của vách đã đặt đúng vị trí trong không gian khuôn.
export function dividerFromSlices(phoiGeo, o) {
  const { a, td, y0, y1, limitR, sprue } = o;
  const ar = a * Math.PI / 180;
  let Umax = 0;
  for (let y = y0; y <= y1; y += 2) Umax = Math.max(Umax, limitR(y));
  Umax += 1;
  const span = Umax, hgt = y1 - y0;
  const h = Math.max(o.cell || 0.12, Math.sqrt((span * hgt) / 7e6));
  const W = Math.ceil(span / h), H = Math.ceil(hgt / h);
  const occ = new Uint8Array(W * H);
  for (const w of [-td / 2, 0, td / 2]) fillFromSegments(planeSegments(phoiGeo, ar, w), occ, W, H, h, 0, y0);
  const reg = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const y = y0 + (j + 0.5) * h, lim = limitR(y), inSprue = sprue && y < sprue.h;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) * h;
      if (u > lim || occ[j * W + i] || (inSprue && u < sprue.R)) continue;
      reg[j * W + i] = 1;
    }
  }
  dropSmall(reg, W, H, Math.ceil(6 / (h * h)));
  if (o.debug) { let c = 0; for (const v of reg) c += v; o.debug.cells = c * h * h; const L = traceLoops(reg, W, H); o.debug.loops = L.map((l) => [l.length, area2(l.map(([i, j]) => [i * h, j * h])) / 2]); }
  const loops = traceLoops(reg, W, H).map((L) => L.map(([i, j]) => [i * h, y0 + j * h]));
  const polys = loops.filter((L) => L.length >= 4).map((L) => {
    const ar2 = area2(L);
    let P = L;
    P = taubin(P, 4);
    P = simplifyClosed(P, 0.02);
    if (o.debug) (o.debug.stages = o.debug.stages || []).push([L.length, ar2 / 2, area2(P) / 2, P.length]);
    return { P, area: ar2 / 2 };
  });
  const outers = polys.filter((q) => q.area > 0).map((q) => ({ ...q, pts: q.P.map(([x, y]) => new THREE.Vector2(x, y)), holes: [] }));
  for (const hq of polys.filter((q) => q.area < 0)) {
    const probe = new THREE.Vector2(hq.P[0][0], hq.P[0][1]);
    let host = null;
    for (const ot of outers) if (inPoly(probe, ot.pts) && (!host || ot.area < host.area)) host = ot;
    if (host) host.holes.push(hq.P.map(([x, y]) => new THREE.Vector2(x, y)));
  }
  const geos = [];
  for (const ot of outers) {
    const shape = new THREE.Shape(ot.pts);
    shape.holes = ot.holes.map((hp) => new THREE.Path(hp));
    const g = new THREE.ExtrudeGeometry(shape, { depth: td, bevelEnabled: false, curveSegments: 1, steps: 1 });
    geos.push(g);
  }
  if (!geos.length) throw new Error('Không dựng được vách chia (mặt cắt rỗng). Kiểm tra góc chia và kích thước phôi.');
  const parts = geos.map((g) => { const q = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(q.attributes)) if (k !== "position" && k !== "normal") q.deleteAttribute(k); return q; });
  let g = parts[0];
  if (parts.length > 1) {
    // gộp các mảnh rời thành một hình học
    let n = 0; for (const q of parts) n += q.attributes.position.array.length;
    const pos = new Float32Array(n), nor = new Float32Array(n); let o2 = 0;
    for (const q of parts) { pos.set(q.attributes.position.array, o2); nor.set(q.attributes.normal.array, o2); o2 += q.attributes.position.array.length; }
    g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  }
  g.translate(0, 0, -td / 2);
  const dvec = new THREE.Vector3(Math.cos(ar), 0, Math.sin(ar)), nvec = new THREE.Vector3(-Math.sin(ar), 0, Math.cos(ar));
  g.applyMatrix4(new THREE.Matrix4().makeBasis(dvec, new THREE.Vector3(0, 1, 0), nvec));
  g.computeVertexNormals();
  return g;
}
