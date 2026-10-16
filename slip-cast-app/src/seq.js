// Đổ thạch cao lần lượt từng mảnh: mỗi mảnh có một "khay" in 3D.
// Khay = khối đặc có rãnh chữ V (đỉnh rãnh nằm trên trục khuôn). Hai mặt rãnh chính là hai mặt chia của mảnh thạch cao,
// phôi + cuống nằm ở đỉnh rãnh. Đổ thạch cao vào rãnh tới mép là ra đúng một mảnh.
// Chốt: mặt chia đầu có chốt lồi (tạo lỗ lõm trên thạch cao), mặt chia cuối có hốc (tạo chốt lồi trên thạch cao),
// nên mảnh k khớp với mảnh k+1 và mảnh cuối khớp mảnh đầu.
import * as THREE from 'three';
import { Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { meshVolume, phoiStats, toBrush, stripGeo, sectorsFromAngles } from './mold.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { invertPhoi, radialProfile, rAt } from './shell.js';

const DEG = Math.PI / 180;

const plain = (g) => { const q = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); if (!q.attributes.normal) q.computeVertexNormals(); return q; };

// Cắt lưới bằng các mặt phẳng, giữ phần có n·p + d >= 0 (không đóng nắp: chỉ dùng để tính thể tích khi mặt phẳng đi qua gốc)
function clipVolume(g, planes) {
  const p = g.attributes.position.array, ix = g.index ? g.index.array : null;
  const nt = (ix ? ix.length : p.length / 3) / 3;
  let vol = 0;
  for (let t = 0; t < nt; t++) {
    let poly = [];
    for (let k = 0; k < 3; k++) { const v = (ix ? ix[3 * t + k] : 3 * t + k) * 3; poly.push([p[v], p[v + 1], p[v + 2]]); }
    for (const [nx, ny, nz, d] of planes) {
      if (!poly.length) break;
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const da = nx * a[0] + ny * a[1] + nz * a[2] + d, db = nx * b[0] + ny * b[1] + nz * b[2] + d;
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) { const f = da / (da - db); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]); }
      }
      poly = out;
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      const a = poly[0], b = poly[i], c = poly[i + 1];
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return vol;
}

// Lăng trụ theo trục X có mặt cắt là đa giác (y,z): ép bằng ExtrudeGeometry rồi đặt trục dọc theo X
function prismX(pts, x0, x1) {
  const shape = new THREE.Shape(pts.map(([y, z]) => new THREE.Vector2(y, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 1, steps: 1 });
  // Extrude: (sx, sy) -> mặt cắt, z -> chiều dài. Đổi sao cho sx->Y, sy->Z, chiều dài->X
  const m = new THREE.Matrix4().set(0, 0, 1, x0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  return plain(g);
}

// Mặt cắt khoang đổ thạch cao (y,z): đỉnh ở trục, mở lên theo +Z, nửa góc h, cao tới zTop (giới hạn bề ngang capW)
function cavityPoly(half, zTop, capW) {
  const c = Math.cos(half), s = Math.sin(half);
  const t = Math.min(c > 1e-6 ? zTop / c : Infinity, s > 1e-6 ? capW / s : Infinity);
  const py = t * s, pz = t * c, cut = pz < zTop - 1e-6;
  const poly = [[0, 0], [py, pz]];
  if (cut) poly.push([py, zTop], [-py, zTop]);
  poly.push([-py, pz]);
  const wTop = py;
  return { poly, wTop };
}
const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };

export function buildSequential(phoi, o, onProgress = () => {}) {
  const { angles, wall, spare, pourR, base, keyR, clear } = o;
  const wc = o.trayWall || 3, lip = 4, tol = Math.max(0.2, clear || 0.3) + 0.1;
  if (!(wall >= 8)) throw new Error('Độ dày thạch cao phải từ 8 mm trở lên');
  if (!(spare >= 5)) throw new Error('Cao cuống rót phải từ 5 mm trở lên');
  if (!(pourR >= 2)) throw new Error('Bán kính cuống rót phải từ 2 mm trở lên');
  if (!(base >= 5)) throw new Error('Lớp thạch cao phủ trên chân phôi phải từ 5 mm trở lên');
  if (!(angles && angles.length >= 2)) throw new Error('Cần ít nhất 2 vách chia');
  const secs = sectorsFromAngles(angles);
  if (secs.some((x) => x.span < 3)) throw new Error('Hai vách chia trùng góc hoặc quá sát nhau (dưới 3°)');
  if (secs.some((x) => x.span > 180.01)) throw new Error('Có mảnh rộng hơn 180°, không tháo ra được');
  const H = phoiStats(phoi).H;
  const yTop = spare + H + base;
  onProgress('Đảo phôi và gắn cuống rót...');
  const inv = invertPhoi(phoi, spare);
  const sprue = new THREE.CylinderGeometry(pourR, pourR, spare + 0.5, 48);
  sprue.translate(0, (spare + 0.5) / 2, 0);
  const prof = radialProfile([inv, sprue], yTop);
  let rmax = pourR;
  { const P = inv.attributes.position; for (let i = 0; i < P.count; i++) rmax = Math.max(rmax, Math.hypot(P.getX(i), P.getZ(i))); }
  const hTop = rmax + wall;              // chiều cao mép thạch cao tính từ trục
  const zTopF = hTop + lip;              // mép khay (cao hơn mức đổ một chút)
  const capW = hTop;                    // thành đứng cách trục ít nhất hTop: mọi chỗ vẫn dày thạch cao >= wall
  const fl = rmax + 4;                   // đáy khay nằm dưới trục để phôi nằm gọn trong khối đặc
  const ev = new Evaluator(); ev.attributes = ['position', 'normal']; ev.useGroups = false;

  // vị trí chốt trên từng mặt chia j (j = 0..n-1)
  const keyCount = Math.max(1, Math.min(3, Math.round(o.keyCount || 2)));
  const keyYs = Array.from({ length: keyCount }, (_, i) => spare + H * (keyCount === 1 ? 0.5 : 0.22 + (0.56 * i) / (keyCount - 1)));
  const alongOuter = (halfAngle) => { const c = Math.cos(halfAngle), s = Math.sin(halfAngle); return Math.min(c > 1e-6 ? hTop / c : Infinity, s > 1e-6 ? capW / s : Infinity) - 2; };
  const faceKeys = secs.map((_, j) => {
    const prev = secs[(j + secs.length - 1) % secs.length], next = secs[j];
    const phi = next.a0 * DEG;
    const rout = Math.min(alongOuter((prev.span / 2) * DEG), alongOuter((next.span / 2) * DEG));
    return keyYs.map((y) => { const rin = rAt(prof, y, phi); return { y, rin, rout, r: (rin + rout) / 2, kr: Math.min(keyR, (rout - rin) / 2 - 2.5) }; });
  });
  const keyOk = keyR > 0 && o.keyType !== 'none' && faceKeys.every((f) => f.every((k) => k.kr >= 2.5));
  const kr = keyOk ? Math.min(...faceKeys.flat().map((k) => k.kr)) : 0;

  const parts = [];
  const pieces = [];
  secs.forEach((s, k) => {
    onProgress(`Khay đổ mảnh ${k + 1}/${secs.length}...`);
    const half = (s.span / 2) * DEG, m = s.mid * DEG;
    // phép xoay từ khung khuôn sang khung khay: X = trục khuôn, Z = hướng phân giác (lên), Y = ngang
    const M = new THREE.Matrix4().set(0, 1, 0, 0, -Math.sin(m), 0, Math.cos(m), 0, Math.cos(m), 0, Math.sin(m), 0, 0, 0, 0, 1);
    const cav = cavityPoly(half, zTopF, capW);
    const halfW = Math.max(cav.wTop, rmax + 2) + wc;
    const outer = new THREE.BoxGeometry(yTop + 2 * wc, 2 * halfW, zTopF + fl);
    outer.translate(yTop / 2, 0, (zTopF - fl) / 2);
    const cavG = prismX(cav.poly, 0, yTop);
    let tray = ev.evaluate(toBrush(plain(outer)), toBrush(cavG), SUBTRACTION);
    if (keyOk) {
      // mặt đầu (−half): chốt lồi; mặt cuối (+half): hốc lõm
      const dirA = [-Math.sin(half), Math.cos(half)], dirB = [Math.sin(half), Math.cos(half)];
      const fa = faceKeys[k], fb = faceKeys[(k + 1) % secs.length];
      const pegs = fa.map((q) => { const g = new THREE.SphereGeometry(kr, 24, 16); g.translate(q.y, dirA[0] * q.r, dirA[1] * q.r); return plain(g); });
      const holes = fb.map((q) => { const g = new THREE.SphereGeometry(kr + tol, 24, 16); g.translate(q.y, dirB[0] * q.r, dirB[1] * q.r); return plain(g); });
      tray = ev.evaluate(toBrush(tray.geometry), toBrush(mergeGeometries(holes)), SUBTRACTION);
      tray = ev.evaluate(toBrush(tray.geometry), toBrush(mergeGeometries(pegs)), ADDITION);
    }
    // phôi + cuống vào khung khay (ghép rời, phần ngoài rãnh chìm trong khối đặc)
    const posG = (g) => { const q = plain(g); q.applyMatrix4(M); return q; };
    const positive = mergeGeometries([posG(inv), posG(sprue)]);
    const trayG = stripGeo(tray.geometry);
    const tg = mergeGeometries([trayG, positive]);
    tg.computeBoundingBox();
    const bb = tg.boundingBox;
    tg.translate(-bb.min.x, -bb.min.y, -bb.min.z); // đáy khay nằm trên bàn in
    parts.push({ kind: 'tray', name: `khay_do_manh_${k + 1}`, label: `Khay mảnh ${k + 1} (${Math.round(s.span)}°)`, geometry: tg, mid: m, frame: { M: M.elements.slice(), shift: [bb.min.x, bb.min.y, bb.min.z] } });
    // thể tích thạch cao của mảnh = khoang − (phôi + cuống) nằm trong khoang
    const cavVol = area(cavityPoly(half, hTop, capW).poly) * yTop;
    // hai mặt chia, pháp tuyến hướng vào khoang (y,z); đi qua trục nên phần "nắp" cắt không ảnh hưởng thể tích
    const inPlanes = [[0, Math.cos(half), Math.sin(half), 0], [0, -Math.cos(half), Math.sin(half), 0]];
    const vPhoi = clipVolume(posG(inv), inPlanes), vSprue = clipVolume(posG(sprue), inPlanes);
    pieces.push({ span: s.span, plasterMm3: Math.max(0, cavVol - vPhoi - vSprue) });
  });

  // phễu rót slip: cổ cắm vào lỗ rót, miệng loe
  const neck = pourR - 0.3, rTop = pourR * 2.4 + 4, fh = 22, collar = 6;
  const fpts = [[neck, 0], [neck, collar], [rTop, fh], [rTop - 1.6, fh], [neck - 1.6, collar], [neck - 1.6, 0]].map(([x, y]) => new THREE.Vector2(x, y));
  let funnel = plain(new THREE.LatheGeometry(fpts, 64));
  funnel = (() => { const g = funnel; if (meshVolume(g) < 0) { const q = new THREE.BufferGeometry(); const P = g.attributes.position.array.slice(); for (let i = 0; i < P.length; i += 9) for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; } q.setAttribute('position', new THREE.BufferAttribute(P, 3)); q.computeVertexNormals(); return q; } return g; })();
  funnel.rotateX(Math.PI / 2); funnel.computeBoundingBox(); funnel.translate(-funnel.boundingBox.min.x, -funnel.boundingBox.min.y, -funnel.boundingBox.min.z);
  parts.push({ kind: 'funnel', name: 'phieu_rot', label: 'Phễu rót slip', geometry: funnel, mid: 0 });
  const total = pieces.reduce((a, p) => a + p.plasterMm3, 0);
  const trayDims = parts.map((p) => { const b = new THREE.Box3().setFromBufferAttribute(p.geometry.attributes.position); return b.getSize(new THREE.Vector3()); });
  return { parts, pieces, plasterMm3: total, keyInfo: keyOk ? { type: 'dome', r: kr, count: faceKeys.flat().length, ballD: 0 } : { type: 'none', r: 0, count: 0 }, dims: { H: hTop, L: yTop + 2 * wc, W: Math.max(...trayDims.map((d) => d.y)), Hh: Math.max(...trayDims.map((d) => d.z)) }, yTop, rmax, fillHeight: hTop };
}
