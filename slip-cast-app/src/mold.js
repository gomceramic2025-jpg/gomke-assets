// Logic tạo khuôn thạch cao nhiều mảnh từ phôi. Đơn vị: mm. Trục đứng = Y.
// Không phụ thuộc giao diện nên có thể chạy thử bằng Node.
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;

// ---------- Hình học cơ bản ----------

export function meshVolume(geo) {
  const p = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    v += a.dot(b.cross(c)) / 6;
  }
  return v; // mm3, âm nếu mặt quay vào trong
}

export function countOpenEdges(geo) {
  const idx = geo.index;
  if (!idx) return -1;
  const m = new Map();
  for (let i = 0; i < idx.count; i += 3) {
    for (let e = 0; e < 3; e++) {
      const x = idx.getX(i + e), y = idx.getX(i + (e + 1) % 3);
      const k = x < y ? x * 4294967296 + y : y * 4294967296 + x;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  let open = 0;
  for (const c of m.values()) if (c !== 2) open++;
  return open;
}

// Chỉ giữ position, hàn các đỉnh trùng, tính lại normal, đảm bảo mặt hướng ra ngoài.
export function cleanGeometry(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-4);
  // Bỏ mặt suy biến (2 đỉnh trùng nhau sau khi hàn), thường gặp ở cực của hình xoay
  const src = g.index.array, keep = [];
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i], b = src[i + 1], c = src[i + 2];
    if (a !== b && b !== c && a !== c) keep.push(a, b, c);
  }
  g.setIndex(keep);
  if (meshVolume(g) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// Xoay (độ) -> đổi đơn vị -> bù co ngót -> đặt đáy y=0, tâm x,z về 0.
export function orientPhoi(base, { unit = 1, rx = 0, rz = 0, shrink = 0 }) {
  const g = base.clone();
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx * DEG, 0, rz * DEG));
  g.applyMatrix4(m);
  const s = unit / (1 - shrink);
  g.scale(s, s, s);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingBox();
  return g;
}

export function phoiStats(g) {
  const bb = g.boundingBox;
  let rmax = 0;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) rmax = Math.max(rmax, Math.hypot(p.getX(i), p.getZ(i)));
  return {
    H: bb.max.y, rmax,
    size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
    volume: Math.abs(meshVolume(g)),
    tris: g.index ? g.index.count / 3 : p.count / 3,
  };
}

// ---------- Kiểm tra góc thoát khuôn ----------

// Mỗi mảnh được kéo ra theo hướng nằm ngang, qua đường phân giác của mảnh.
export function prepareFaces(g) {
  const p = g.attributes.position, idx = g.index;
  const nt = idx ? idx.count / 3 : p.count / 3;
  const ang = new Float32Array(nt), nx = new Float32Array(nt), ny = new Float32Array(nt), nz = new Float32Array(nt), area = new Float32Array(nt);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    const ia = idx ? idx.getX(3 * t) : 3 * t, ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1, ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    e1.subVectors(b, a); e2.subVectors(c, a);
    e1.cross(e2);
    const ar = e1.length() / 2;
    area[t] = ar;
    if (ar > 0) e1.divideScalar(2 * ar);
    nx[t] = e1.x; ny[t] = e1.y; nz[t] = e1.z;
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
    ang[t] = Math.atan2(cz, cx) / DEG;
  }
  return { nt, ang, nx, ny, nz, area };
}

// Trả về class từng mặt: 0 tốt, 1 ít góc thoát, 2 undercut.
export function analyzeDraft(F, n, theta0, minDraftDeg = 1) {
  const s = 360 / n, lim = Math.sin(minDraftDeg * DEG);
  const cls = new Uint8Array(F.nt);
  const area = [0, 0, 0];
  for (let t = 0; t < F.nt; t++) {
    let c = 0;
    if (Math.abs(F.ny[t]) < 0.985) {
      let r = (((F.ang[t] - theta0) % 360) + 360) % 360;
      const k = Math.floor(r / s);
      const mid = (theta0 + (k + 0.5) * s) * DEG;
      const d = F.nx[t] * Math.cos(mid) + F.nz[t] * Math.sin(mid);
      c = d < -0.02 ? 2 : d < lim ? 1 : 0;
    }
    cls[t] = c;
    area[c] += F.area[t];
  }
  return { cls, area };
}

export function bestTheta(F, n, minDraftDeg) {
  const s = 360 / n;
  let best = 0, bs = Infinity;
  for (let t = 0; t < s; t += 2) {
    const r = analyzeDraft(F, n, t, minDraftDeg).area;
    const sc = r[2] * 10 + r[1];
    if (sc < bs) { bs = sc; best = t; }
  }
  return best;
}

// ---------- Tạo khuôn ----------

function wedgeGeometry(a0, span, L, y0, depth) {
  const pts = [];
  if (span < 180 - 1e-6) pts.push([0, 0]);
  const m = Math.ceil(span / 40) + 1;
  for (let i = 0; i <= m; i++) {
    const a = (a0 + (span * i) / m) * DEG;
    pts.push([L * Math.cos(a), L * Math.sin(a)]);
  }
  const shape = new THREE.Shape();
  // Extrude nằm trong XY rồi xoay về XZ: (x, y) -> (x, ., -y) nên phải đảo dấu.
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function toBrush(g) {
  const b = new Brush(g);
  b.updateMatrixWorld(true);
  return b;
}

function stripGeo(g) {
  const out = new THREE.BufferGeometry();
  const ng = g.index ? g.toNonIndexed() : g;
  out.setAttribute('position', ng.attributes.position);
  out.setAttribute('normal', ng.attributes.normal);
  return out;
}

function frameGeo(g, aDeg) { g.rotateY(-aDeg * DEG); return g; }
// Hộp trong hệ tọa độ của mặt chia: x = u (dọc mặt chia), z = v (vuông góc, hướng vào mảnh), y = trục đứng.
function boxAt(aDeg, u0, u1, v0, v1, y0, y1) {
  const g = new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0);
  g.translate((u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2);
  return frameGeo(g, aDeg);
}

// Khuôn 2 mảnh dạng hộp chữ nhật: đổ được trong hộp đổ in 3D.
function buildBoxMold(phoi, o, onProgress) {
  const { theta0, wall, base, spare, pourR, keys, tol } = o;
  const st = phoiStats(phoi);
  const H = st.H, top = H + spare, bottom = -base;
  const pp = phoi.attributes.position;
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;
  const proj = (a) => {
    const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
    let eu = 0, vmax = 0, vmin = 0;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), z = pp.getZ(i);
      eu = Math.max(eu, Math.abs(x * c + z * s));
      const v = -x * s + z * c;
      vmax = Math.max(vmax, v); vmin = Math.min(vmin, v);
    }
    return { eu, vmax, vmin };
  };
  const p0 = proj(theta0), p1 = proj(theta0 + 180);
  const U = Math.max(p0.eu, p1.eu) + wall;
  const T = Math.max(p0.vmax, p1.vmax) + wall;
  const keyR = Math.min(8, Math.max(3, wall * 0.28));

  const holeLen = spare + 1.5;
  const holeG = new THREE.CylinderGeometry(pourR, pourR, holeLen, 48);
  holeG.translate(0, H - 0.5 + holeLen / 2, 0);
  const holeB = toBrush(holeG), phoiB = toBrush(phoi);
  const spots = [];
  for (const f of [0.25, 0.75]) {
    const y = H * f, band = Math.max(H * 0.08, 3);
    let eu = 0;
    for (let i = 0; i < pp.count; i++) if (Math.abs(pp.getY(i) - y) < band) eu = Math.max(eu, Math.hypot(pp.getX(i), pp.getZ(i)));
    if (eu === 0) eu = st.rmax;
    spots.push({ y, u: Math.min((eu + U) / 2, U - keyR - 2) });
  }

  const pieces = [];
  for (let k = 0; k < 2; k++) {
    onProgress(`Cắt mảnh ${k + 1}/2...`);
    const aS = theta0 + k * 180;
    let piece = ev.evaluate(toBrush(boxAt(aS, -U, U, 0, T, bottom, top)), holeB, SUBTRACTION);
    piece = ev.evaluate(toBrush(piece.geometry), phoiB, SUBTRACTION);
    if (keys) {
      for (const sp of spots) {
        // ổ lõm (cái) ở phía +u, chốt lồi (đực) ở phía -u; mảnh kia ngược lại nên khớp nhau
        const male = new THREE.SphereGeometry(keyR, 24, 16);
        male.translate(-sp.u, sp.y, 0);
        piece = ev.evaluate(toBrush(piece.geometry), toBrush(frameGeo(male, aS)), ADDITION);
        const fem = new THREE.SphereGeometry(keyR + tol, 24, 16);
        fem.translate(sp.u, sp.y, 0);
        piece = ev.evaluate(toBrush(piece.geometry), toBrush(frameGeo(fem, aS)), SUBTRACTION);
      }
    }
    const geo = stripGeo(piece.geometry);
    pieces.push({ geometry: geo, raw: piece.geometry, volume: Math.abs(meshVolume(geo)), mid: (aS + 90) * DEG, aStart: aS });
  }
  return { shape: 'box', pieces, R: Math.max(U, T), U, T, top, bottom, keyR, tol, dims: { W: 2 * U, T, H: top - bottom } };
}

// Hộp đổ in 3D cho 1 mảnh: sàn = mặt chia, có sẵn nửa phôi, lỗ rót và chốt nhô lên. Đổ thạch cao tới mép tường.
export function buildCasing(mold, k, wc = 3) {
  // Đôi khi CSG gặp mặt trùng khít do số học; thử lại với sai lệch rất nhỏ (< 0,1 mm).
  let err;
  for (const j of [0, 0.013, 0.031, 0.057, 0.083]) {
    try { return casingAttempt(mold, k, wc, j); } catch (e) { err = e; }
  }
  throw err;
}

function casingAttempt(mold, k, wc, j) {
  const { U, T, top, bottom, keyR, tol } = mold;
  const piece = mold.pieces[k];
  const aS = piece.aStart, lip = 5;
  const fT = keyR + tol + 3;
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;
  const outer = boxAt(aS, -(U + wc), U + wc, -fT, T + lip, bottom - wc, top + wc);
  const cut = boxAt(aS, -U, U, 0, T + lip + 5, bottom, top);
  let c = ev.evaluate(toBrush(outer), toBrush(cut), SUBTRACTION);
  // lấp phần lòng hộp (0..T) rồi trừ mảnh khuôn: còn lại nửa phôi + trụ rót + chốt
  const h = wc / 2 + j * 3;
  c = ev.evaluate(toBrush(c.geometry), toBrush(boxAt(aS, -(U + h), U + h, -fT / 2, T - 0.01 - j, bottom - h, top + h)), ADDITION);
  // Làm sạch mặt suy biến (mảnh vụn sinh ra khi cắt chốt) để phép trừ không bị lỗi
  c = ev.evaluate(toBrush(c.geometry), toBrush(cleanGeometry(piece.raw)), SUBTRACTION);
  const g = stripGeo(c.geometry);
  // đặt nằm trên bàn in: mặt chia nằm ngang, hướng lên
  g.rotateY(aS * DEG);
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  g.translate(-(g.boundingBox.min.x + g.boundingBox.max.x) / 2, -g.boundingBox.min.y, -(g.boundingBox.min.z + g.boundingBox.max.z) / 2);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  return { geometry: g, size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z], volume: Math.abs(meshVolume(g)) };
}

export function buildMold(phoi, o, onProgress = () => {}) {
  if (o.shape === 'box') return buildBoxMold(phoi, o, onProgress);
  const { n, theta0, wall, base, spare, pourR, keys, tol } = o;
  const st = phoiStats(phoi);
  const H = st.H, R = st.rmax + wall;
  const top = H + spare, bottom = -base;
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;

  // Khối khuôn tròn - lỗ rót - phôi
  const blockG = new THREE.CylinderGeometry(R, R, top - bottom, 96);
  blockG.translate(0, (top + bottom) / 2, 0);
  const holeLen = spare + 1.5;
  const holeG = new THREE.CylinderGeometry(pourR, pourR, holeLen, 48);
  holeG.translate(0, H - 0.5 + holeLen / 2, 0);
  onProgress('Trừ lỗ rót và phôi...');
  let core = ev.evaluate(toBrush(blockG), toBrush(holeG), SUBTRACTION);
  core = ev.evaluate(toBrush(core.geometry), toBrush(phoi), SUBTRACTION);

  // Vị trí chốt định vị: 2 chốt trên mỗi mặt chia
  const keyR = Math.min(8, Math.max(3, wall * 0.28));
  const keySpots = [];
  const pp = phoi.attributes.position;
  for (const f of [0.25, 0.75]) {
    const y = H * f, band = Math.max(H * 0.08, 3);
    let re = 0;
    for (let i = 0; i < pp.count; i++) if (Math.abs(pp.getY(i) - y) < band) re = Math.max(re, Math.hypot(pp.getX(i), pp.getZ(i)));
    if (re === 0) re = st.rmax;
    keySpots.push({ y, r: (re + R) / 2 });
  }

  const span = 360 / n;
  const pieces = [];
  for (let k = 0; k < n; k++) {
    onProgress(`Cắt mảnh ${k + 1}/${n}...`);
    const a0 = theta0 + k * span;
    const wedge = wedgeGeometry(a0, span, R * 1.6, bottom - 5, top - bottom + 10);
    let piece = ev.evaluate(toBrush(core.geometry), toBrush(wedge), INTERSECTION);
    if (keys) {
      const aEnd = (a0 + span) * DEG, aStart = a0 * DEG;
      for (const s of keySpots) {
        const male = new THREE.SphereGeometry(keyR, 24, 16);
        male.translate(s.r * Math.cos(aEnd), s.y, s.r * Math.sin(aEnd));
        piece = ev.evaluate(toBrush(piece.geometry), toBrush(male), ADDITION);
        const fem = new THREE.SphereGeometry(keyR + tol, 24, 16);
        fem.translate(s.r * Math.cos(aStart), s.y, s.r * Math.sin(aStart));
        piece = ev.evaluate(toBrush(piece.geometry), toBrush(fem), SUBTRACTION);
      }
    }
    const geo = stripGeo(piece.geometry);
    pieces.push({ geometry: geo, volume: Math.abs(meshVolume(geo)), mid: (a0 + span / 2) * DEG });
  }
  return { shape: 'round', pieces, R, top, bottom, dims: { D: 2 * R, H: top - bottom } };
}

// ---------- Tính thạch cao ----------

const PLASTER_DENSITY = 2.63; // g/cm3, hạt thạch cao (hemihydrate)

// ratio = nước / thạch cao theo khối lượng (vd 0.7 = 70 nước : 100 thạch cao)
export function plasterCalc(volMm3, ratio, wastePct) {
  const V = (volMm3 / 1000) * (1 + wastePct / 100); // cm3 hồ cần pha
  const plaster = V / (1 / PLASTER_DENSITY + ratio);
  return { slurryMl: V, plasterG: plaster, waterMl: plaster * ratio };
}
