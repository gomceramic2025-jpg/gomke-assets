// Các việc tính toán nặng. Chạy trong Web Worker (không làm đứng trang); nếu không tạo được Worker thì chạy trực tiếp.
import * as THREE from 'three';
import { cleanGeometry, countOpenEdges, prepareFaces, bestLayout, buildMold, buildCasing, orientPhoi } from './mold.js';
import { buildShell } from './shell.js';
import { repairMesh } from './repair.js';

// ---- đóng gói hình học để gửi qua worker ----
export function pack(g, withIndex = true) {
  const o = { pos: g.attributes.position.array };
  if (g.attributes.normal) o.nor = g.attributes.normal.array;
  if (withIndex && g.index) o.index = g.index.array;
  return o;
}
export function unpack(o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.pos, 3));
  if (o.nor) g.setAttribute('normal', new THREE.BufferAttribute(o.nor, 3));
  if (o.index) g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingBox(); // các hàm dựng khuôn đọc boundingBox
  return g;
}
// bản sao: dùng khi worker còn cần giữ dữ liệu gốc sau khi gửi đi
const packCopy = (g) => { const o = pack(g, false); return { pos: Float32Array.from(o.pos), nor: o.nor ? Float32Array.from(o.nor) : undefined }; };
const copyOf = (o) => ({ pos: Float32Array.from(o.pos), nor: o.nor ? Float32Array.from(o.nor) : undefined, index: o.index ? Uint32Array.from(o.index) : undefined });
const bufs = (list) => { const s = new Set(); for (const o of list) for (const k of ['pos', 'nor', 'index']) if (o[k]) s.add(o[k].buffer); return [...s]; };

let lastMold = null; // giữ lại để tạo hộp đổ sau đó (cần hình học gốc của từng mảnh)

export const handlers = {
  // Làm sạch lưới (hàn đỉnh, bỏ mặt suy biến) và tự vá nếu lưới hở.
  prepare({ geo, autoRepair, res }, progress) {
    progress('Đang làm sạch lưới...');
    const raw = unpack(geo);
    let g = cleanGeometry(raw);
    const openBefore = countOpenEdges(g);
    let info = { openBefore, repaired: false, openAfter: openBefore, voxel: 0 };
    if (openBefore > 0 && autoRepair) {
      const r = repairMesh(g, { res, onProgress: progress });
      g = r.geometry;
      info = { openBefore, repaired: true, openAfter: countOpenEdges(g), voxel: r.voxel };
    }
    const out = pack(g);
    return { result: { geo: out, info }, transfer: bufs([out]) };
  },

  // Chọn số mảnh và góc chia ít undercut nhất
  layout({ phoi, spare, minDraft }, progress) {
    progress('Đang phân tích số mảnh và góc chia...');
    const inv = unpack(phoi);
    // phôi đã đảo sẵn ở phía gọi
    const F = prepareFaces(inv);
    const b = bestLayout(F, minDraft);
    void spare;
    return { result: { angles: b.angles, n: b.n } };
  },

  shell({ phoi, o }, progress) {
    const r = buildShell(unpack(phoi), o, progress);
    const parts = r.parts.map((p) => ({ kind: p.kind, name: p.name, label: p.label, mid: p.mid, geo: pack(p.geometry, false) }));
    return { result: { parts, plasterMm3: r.plasterMm3, yTop: r.yTop, rmax: r.rmax, dims: r.dims, H: r.H }, transfer: bufs(parts.map((p) => p.geo)) };
  },

  mold({ phoi, o }, progress) {
    const m = buildMold(unpack(phoi), o, progress);
    lastMold = m;
    const pieces = m.pieces.map((p) => ({ geo: packCopy(p.geometry), volume: p.volume, mid: p.mid }));
    const meta = { shape: m.shape, R: m.R, top: m.top, bottom: m.bottom, dims: m.dims };
    return { result: { ...meta, pieces }, transfer: bufs(pieces.map((p) => p.geo)) };
  },

  casing({ k }, progress) {
    if (!lastMold || lastMold.shape !== 'box') throw new Error('Hãy tạo lại khuôn dạng hộp trước khi tạo hộp đổ');
    progress(`Đang tạo hộp đổ mảnh ${k + 1}...`);
    const c = buildCasing(lastMold, k);
    const geo = pack(c.geometry, false);
    return { result: { geo, size: c.size, volume: c.volume }, transfer: bufs([geo]) };
  },
};

export { orientPhoi, copyOf };
