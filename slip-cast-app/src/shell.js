// Module "Hộp bao": hộp in 3D bao quanh phôi để đổ thạch cao trực tiếp, thạch cao tự chia mảnh.
// Khung làm khuôn: phôi ĐẢO NGƯỢC (miệng úp xuống đế) + cuống rót; chân phôi hướng lên, thạch cao đổ từ trên xuống.
import * as THREE from 'three';
import { Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { cleanGeometry, meshVolume, phoiStats, toBrush, stripGeo, sectorsFromAngles } from './mold.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// Đảo phôi: miệng (đỉnh cũ) nằm tại y = spare, chân ở trên cùng.
export function invertPhoi(phoi, spare) {
  const H = phoiStats(phoi).H;
  const g = phoi.clone();
  g.rotateX(Math.PI);
  g.translate(0, H + spare, 0);
  g.computeBoundingBox();
  return g;
}

// ---------- Đường bao theo (độ cao, góc) ----------

// Bán kính lớn nhất của các hình theo từng ô (y, góc), giãn ra ô lân cận và làm mượt, chỉ để phủ rộng hơn.
export function radialProfile(geos, yMax, dy = 3, nPhi = 72) {
  const ny = Math.ceil(yMax / dy) + 1;
  const R = new Float32Array(ny * nPhi);
  const put = (x, y, z) => {
    const iy = Math.max(0, Math.min(ny - 1, Math.round(y / dy)));
    let a = Math.atan2(z, x); if (a < 0) a += TAU;
    const ip = Math.min(nPhi - 1, Math.floor((a / TAU) * nPhi));
    const r = Math.hypot(x, z), k = iy * nPhi + ip;
    if (r > R[k]) R[k] = r;
  };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const step = Math.max(1, dy * 0.6);
  for (const g of geos) {
    const p = g.attributes.position, ix = g.index, nt = ix ? ix.count / 3 : p.count / 3;
    for (let t = 0; t < nt; t++) {
      A.fromBufferAttribute(p, ix ? ix.getX(3 * t) : 3 * t);
      B.fromBufferAttribute(p, ix ? ix.getX(3 * t + 1) : 3 * t + 1);
      C.fromBufferAttribute(p, ix ? ix.getX(3 * t + 2) : 3 * t + 2);
      const L = Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A));
      const n = Math.max(1, Math.ceil(L / step));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        put(A.x * w + B.x * u + C.x * v, A.y * w + B.y * u + C.y * v, A.z * w + B.z * u + C.z * v);
      }
    }
  }
  const at = (a, y, p) => a[Math.max(0, Math.min(ny - 1, y)) * nPhi + ((p % nPhi) + nPhi) % nPhi];
  // giãn ra ô lân cận để phủ kín giữa các mẫu
  let cur = Float32Array.from(R);
  for (let y = 0; y < ny; y++) for (let p = 0; p < nPhi; p++) {
    let m = 0;
    for (let dyy = -1; dyy <= 1; dyy++) for (let dp = -1; dp <= 1; dp++) m = Math.max(m, at(R, y + dyy, p + dp));
    cur[y * nPhi + p] = m;
  }
  // ô trống: lấy theo hàng trên/dưới gần nhất cùng góc
  for (let p = 0; p < nPhi; p++) {
    let last = 0;
    for (let y = 0; y < ny; y++) { const v = cur[y * nPhi + p]; if (v > 0) last = v; else if (last) cur[y * nPhi + p] = last; }
    last = 0;
    for (let y = ny - 1; y >= 0; y--) { const v = cur[y * nPhi + p]; if (v > 0) last = v; else if (last) cur[y * nPhi + p] = last; }
  }
  // làm mượt nhưng không bao giờ thấp hơn bản gốc
  for (let it = 0; it < 2; it++) {
    const nx = Float32Array.from(cur);
    for (let y = 0; y < ny; y++) for (let p = 0; p < nPhi; p++) {
      const s = (at(cur, y, p - 1) + 2 * at(cur, y, p) + at(cur, y, p + 1)) / 4;
      const t = (at(cur, y - 1, p) + 2 * s + at(cur, y + 1, p)) / 4;
      nx[y * nPhi + p] = Math.max(cur[y * nPhi + p], t);
    }
    cur = nx;
  }
  return { R: cur, ny, nPhi, dy };
}

function rAt(prof, y, phi) {
  const { R, ny, nPhi, dy } = prof;
  const fy = Math.max(0, Math.min(ny - 1, y / dy));
  const y0 = Math.floor(fy), y1 = Math.min(ny - 1, y0 + 1), ty = fy - y0;
  let a = phi % TAU; if (a < 0) a += TAU;
  const fp = (a / TAU) * nPhi - 0.5;
  const p0 = Math.floor(fp), tp = fp - p0;
  const q0 = ((p0 % nPhi) + nPhi) % nPhi, q1 = (q0 + 1) % nPhi;
  const v0 = R[y0 * nPhi + q0] * (1 - tp) + R[y0 * nPhi + q1] * tp;
  const v1 = R[y1 * nPhi + q0] * (1 - tp) + R[y1 * nPhi + q1] * tp;
  return v0 * (1 - ty) + v1 * ty;
}

// Khối kín bao quanh trục, bán kính = đường bao + offset, từ y0 đến y1.
function radialSolid(prof, offset, y0, y1, nSeg = 144) {
  const rows = Math.max(2, Math.ceil((y1 - y0) / (prof.dy / 2)) + 1);
  const pos = [], idx = [];
  for (let j = 0; j < rows; j++) {
    const y = y0 + ((y1 - y0) * j) / (rows - 1);
    for (let i = 0; i < nSeg; i++) {
      const a = (TAU * i) / nSeg;
      const r = rAt(prof, y, a) + offset;
      pos.push(r * Math.cos(a), y, r * Math.sin(a));
    }
  }
  const bot = pos.length / 3; pos.push(0, y0, 0);
  const top = bot + 1; pos.push(0, y1, 0);
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < nSeg; i++) {
    const a = j * nSeg + i, b = j * nSeg + ((i + 1) % nSeg), c = (j + 1) * nSeg + i, d = (j + 1) * nSeg + ((i + 1) % nSeg);
    idx.push(a, b, c, b, d, c);
  }
  const o = (rows - 1) * nSeg;
  for (let i = 0; i < nSeg; i++) { idx.push(bot, (i + 1) % nSeg, i); idx.push(top, o + i, o + ((i + 1) % nSeg)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return cleanGeometry(g);
}

// ---------- Đa giác cắt theo mảnh ----------

function clip(poly, nx, nz, c) { // giữ điểm có p·n >= c
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = p[0] * nx + p[1] * nz - c, dq = q[0] * nx + q[1] * nz - c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

function extrudePoly(pts, y0, y1) {
  const shape = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

// Mảnh giữa 2 vách (a0 -> a1), thu vào trong mỗi bên một đoạn off.
function sectorSolid(a0, a1, off, L, y0, y1) {
  let poly = Array.from({ length: 96 }, (_, i) => [L * Math.cos((TAU * i) / 96), L * Math.sin((TAU * i) / 96)]);
  poly = clip(poly, -Math.sin(a0 * DEG), Math.cos(a0 * DEG), off);
  poly = clip(poly, Math.sin(a1 * DEG), -Math.cos(a1 * DEG), off);
  return extrudePoly(poly, y0, y1);
}

// Vách phẳng dạng tia từ trục ra ngoài, dày td.
function slabSolid(a, td, L, y0, y1) {
  const u = [Math.cos(a * DEG), Math.sin(a * DEG)], n = [-u[1], u[0]], h = td / 2;
  const pt = (s, w) => [u[0] * s + n[0] * w, u[1] * s + n[1] * w];
  return extrudePoly([pt(0, -h), pt(L, -h), pt(L, h), pt(0, h)], y0, y1);
}

// ---------- Dựng toàn bộ hộp bao ----------

export function buildShell(phoi, o, onProgress = () => {}) {
  const { angles, wall, shell: t, divider: td, gap, spare, pourR, base, keyR, clear } = o;
  // Kiểm tra đầu vào: giá trị vô lý làm CSG ra kết quả sai hoặc sập
  if (!(wall >= 8)) throw new Error('Độ dày thạch cao phải từ 8 mm trở lên');
  if (!(t >= 0.8)) throw new Error('Độ dày vỏ in phải từ 0,8 mm trở lên');
  if (!(td >= 0.6)) throw new Error('Độ dày vách chia phải từ 0,6 mm trở lên');
  if (!(spare >= 5)) throw new Error('Cao cuống rót phải từ 5 mm trở lên');
  if (!(pourR >= 2)) throw new Error('Bán kính cuống rót phải từ 2 mm trở lên');
  if (!(base >= 5)) throw new Error('Lớp thạch cao phủ trên chân phôi phải từ 5 mm trở lên');
  if (!(angles && angles.length >= 2)) throw new Error('Cần ít nhất 2 vách chia');
  const secs = sectorsFromAngles(angles);
  if (secs.some((x) => x.span < 3)) throw new Error('Hai vách chia trùng góc hoặc quá sát nhau (dưới 3°)');
  if (secs.some((x) => x.span > 180.01)) throw new Error('Có mảnh rộng hơn 180°, không tháo ra được');
  const st = phoiStats(phoi);
  const H = st.H;
  const yTop = spare + H + base, yPanel = yTop + 4;
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;
  const ex = (a, b, op) => ev.evaluate(toBrush(a.isBufferGeometry ? a : a.geometry), toBrush(b.isBufferGeometry ? b : b.geometry), op);

  onProgress('Đảo phôi và gắn cuống rót...');
  const inv = invertPhoi(phoi, spare);
  const sprue = new THREE.CylinderGeometry(pourR, pourR, spare + 0.5, 48);
  sprue.translate(0, (spare + 0.5) / 2, 0);
  const positive = stripGeo(ex(inv, sprue, ADDITION).geometry);

  onProgress('Tính đường bao uốn theo phôi...');
  const prof = radialProfile([inv, sprue], yTop);
  let rmax = 0;
  for (let i = 0; i < prof.R.length; i++) rmax = Math.max(rmax, prof.R[i]);
  const Lbig = (rmax + wall + t) * 2 + 20;

  // phôi nới nhẹ theo phương ngang để vách chia lắp vào được
  const sc = 1 + clear / Math.max(rmax, 1);
  const invC = inv.clone(); invC.scale(sc, 1, sc);
  const sprueC = sprue.clone(); sprueC.scale(sc, 1, sc);

  const E0 = radialSolid(prof, wall, 0, yTop);
  const outerSolid = radialSolid(prof, wall + t, 0, yPanel);
  const sec = sectorsFromAngles(angles);
  const parts = [];

  onProgress('Tạo vỏ ngoài...');
  const tube = ev.evaluate(toBrush(outerSolid), toBrush(radialSolid(prof, wall, -1, yPanel + 1)), SUBTRACTION);
  const tubeG = tube.geometry;
  sec.forEach((s, k) => {
    onProgress(`Vỏ ngoài ${k + 1}/${sec.length}...`);
    const w = sectorSolid(s.a0, s.a1, td / 2 + gap, Lbig, -2, yPanel + 2);
    const pn = ex(tubeG, w, INTERSECTION);
    parts.push({ kind: 'panel', name: `vo_ngoai_${k + 1}`, label: `Vỏ ${k + 1}`, geometry: stripGeo(pn.geometry), mid: s.mid * DEG });
  });

  // chốt định vị: hai chấm tròn mỗi mặt vách, tạo lỗ lõm trên thạch cao
  const keySpots = [0.3, 0.7].map((f) => ({ y: spare + H * f }));

  const dividerBase = radialSolid(prof, wall + t, 0, yPanel);
  const invCBrush = toBrush(invC), sprueCBrush = toBrush(sprueC);
  // Vách chia: nếu mặt phẳng cắt trùng đúng mặt đối xứng của phôi, phép trừ có thể sinh số mặt khổng lồ.
  // Khi đó thử lại với góc lệch rất nhỏ (< 0,2 độ), không ảnh hưởng thực tế.
  const makeDivider = (a, nudge) => {
    const ang = a + nudge;
    let d = ex(slabSolid(ang, td + Math.abs(nudge) * 0.1, Lbig, 0, yPanel), dividerBase, INTERSECTION);
    d = ev.evaluate(toBrush(d.geometry), invCBrush, SUBTRACTION);
    d = ev.evaluate(toBrush(d.geometry), sprueCBrush, SUBTRACTION);
    if (keyR > 0) {
      for (const ks of keySpots) {
        const rp = rAt(prof, ks.y, ang * DEG) + wall * 0.5;
        const sp = new THREE.SphereGeometry(keyR, 20, 14);
        sp.translate(rp * Math.cos(ang * DEG), ks.y, rp * Math.sin(ang * DEG));
        d = ev.evaluate(toBrush(d.geometry), toBrush(sp), ADDITION);
      }
    }
    return d;
  };
  angles.slice().sort((a, b) => a - b).forEach((a, k, arr) => {
    onProgress(`Vách chia ${k + 1}/${arr.length}...`);
    let d = null;
    for (const nudge of [0.07, -0.11, 0.19, 0]) {
      d = makeDivider(a, nudge);
      const g0 = d.geometry; if ((g0.index ? g0.index.count : g0.attributes.position.count) / 3 < 200000) break;
    }
    parts.push({ kind: 'divider', name: `vach_chia_${k + 1}`, label: `Vách ${k + 1}`, geometry: stripGeo(d.geometry), mid: a * DEG });
  });

  onProgress('Tạo đế...');
  const plateR = rmax + wall + t + 12;
  const plate = new THREE.CylinderGeometry(plateR, plateR, 5, 96);
  plate.translate(0, -2.5, 0);
  const lipOut = radialSolid(prof, wall + t + 0.3 + 3, -1, 4.5);
  const lipIn = radialSolid(prof, wall + t + 0.3, -2, 6);
  const lip = ev.evaluate(toBrush(lipOut), toBrush(lipIn), SUBTRACTION);
  const baseP = ev.evaluate(toBrush(plate), toBrush(lip.geometry), ADDITION);
  parts.push({ kind: 'base', name: 'de', label: 'Đế', geometry: stripGeo(baseP.geometry), mid: 0 });
  parts.push({ kind: 'phoi', name: 'phoi_dao_nguoc_kem_cuong', label: 'Phôi + cuống', geometry: positive, mid: 0 });

  const vol = (g) => Math.abs(meshVolume(g.index ? g : g.toNonIndexed()));
  const divVol = parts.filter((p) => p.kind === 'divider').reduce((s, p) => s + vol(p.geometry), 0);
  const plasterMm3 = Math.max(0, vol(E0) - vol(inv) - vol(sprue) - divVol);
  return { parts, plasterMm3, yTop, rmax, dims: { D: 2 * (rmax + wall + t), H: yPanel }, H };
}
