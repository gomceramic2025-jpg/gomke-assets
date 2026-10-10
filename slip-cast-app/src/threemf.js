// Đọc file 3MF (zip chứa XML). Chạy được trong Web Worker và Node 18+.
// Trả về danh sách mặt tam giác (9 số float mỗi mặt) theo milimét, đã áp dụng mọi phép biến đổi và vị trí trong dự án.

// ---------- giải nén zip ----------
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('trình duyệt này chưa hỗ trợ giải nén file 3MF. Hãy dùng Chrome, Edge hoặc Safari bản mới');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function listZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('không phải file zip hợp lệ (3MF thực chất là file zip)');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder(), out = new Map();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('danh mục zip bị hỏng');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    out.set(name, { method, csize, usize, off });
    p += 46 + nl + xl + cl;
  }
  return out;
}

export async function readZipEntry(buf, entries, name) {
  const en = entries.get(name);
  if (!en) throw new Error('thiếu mục “' + name + '” trong file 3MF');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const start = en.off + 30 + dv.getUint16(en.off + 26, true) + dv.getUint16(en.off + 28, true);
  const raw = buf.subarray(start, start + en.csize);
  if (en.method === 0) return raw;
  if (en.method === 8) return inflateRaw(raw);
  throw new Error('kiểu nén zip ' + en.method + ' chưa được hỗ trợ');
}

// ---------- đọc XML bằng cách quét byte (nhanh với file hàng trăm MB) ----------
const LT = 60, GT = 62, SP = 32, EQ = 61, QT = 34, SL = 47;

function parseNum(u8, a, b) { // số thực dạng 12.5, -3e-5
  let i = a, neg = false, v = 0;
  if (u8[i] === 45) { neg = true; i++; } else if (u8[i] === 43) i++;
  while (i < b && u8[i] >= 48 && u8[i] <= 57) { v = v * 10 + (u8[i] - 48); i++; }
  if (i < b && u8[i] === 46) { i++; let f = 0.1; while (i < b && u8[i] >= 48 && u8[i] <= 57) { v += (u8[i] - 48) * f; f *= 0.1; i++; } }
  if (i < b && (u8[i] === 101 || u8[i] === 69)) { i++; let en = false, e = 0; if (u8[i] === 45) { en = true; i++; } else if (u8[i] === 43) i++; while (i < b && u8[i] >= 48 && u8[i] <= 57) { e = e * 10 + (u8[i] - 48); i++; } v *= Math.pow(10, en ? -e : e); }
  return neg ? -v : v;
}

function isName(u8, a, b, str) { if (b - a !== str.length) return false; for (let i = 0; i < str.length; i++) if (u8[a + i] !== str.charCodeAt(i)) return false; return true; }

// Gọi cb(tên, bắt đầu, kết thúc, đóng) cho mỗi thẻ; đọc thuộc tính bằng attrs()
function scanTags(u8, cb) {
  const n = u8.length;
  let i = 0;
  while (i < n) {
    if (u8[i] !== LT) { i++; continue; }
    let j = i + 1;
    const closing = u8[j] === SL; if (closing) j++;
    if (u8[j] === 63 || u8[j] === 33) { while (j < n && u8[j] !== GT) j++; i = j + 1; continue; } // <? ... ?> hoặc <!-- -->
    const ns = j;
    while (j < n && u8[j] !== SP && u8[j] !== GT && u8[j] !== SL && u8[j] !== 10 && u8[j] !== 13 && u8[j] !== 9) j++;
    const ne = j;
    let k = j; while (k < n && u8[k] !== GT) { if (u8[k] === QT) { k++; while (k < n && u8[k] !== QT) k++; } k++; }
    cb(ns, ne, ne, k, closing);
    i = k + 1;
  }
}

function attrs(u8, a, b) { // trả về Map tên -> [bắt đầu, kết thúc] của giá trị
  const m = new Map(); let i = a;
  while (i < b) {
    while (i < b && (u8[i] === SP || u8[i] === 10 || u8[i] === 13 || u8[i] === 9)) i++;
    const ns = i; while (i < b && u8[i] !== EQ && u8[i] !== SP && u8[i] !== SL) i++;
    const ne = i;
    if (u8[i] !== EQ) { i++; continue; }
    i++; while (i < b && u8[i] !== QT && u8[i] !== 39) i++;
    const q = u8[i]; i++;
    const vs = i; while (i < b && u8[i] !== q) i++;
    m.set(String.fromCharCode(...u8.subarray(ns, ne)), [vs, i]);
    i++;
  }
  return m;
}

class Grow { constructor(T, n = 1 << 16) { this.T = T; this.a = new T(n); this.n = 0; } push(v) { if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; } out() { return this.a.subarray(0, this.n); } }

function parseTransform(s) { // 12 số: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : null;
}
const IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function compose(a, b) { // áp dụng a trước rồi b (quy ước vector hàng của 3MF)
  const r = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  for (let j = 0; j < 3; j++) r[9 + j] = a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j];
  return r;
}

function parseModel(u8) {
  const objects = new Map(), items = []; let unit = 'millimeter';
  let cur = null, inMesh = false;
  const dec = (a, b) => String.fromCharCode(...u8.subarray(a, b));
  scanTags(u8, (ns, ne, as, ae, closing) => {
    if (closing) { if (isName(u8, ns, ne, 'object')) { cur = null; inMesh = false; } return; }
    if (isName(u8, ns, ne, 'vertex')) {
      if (!cur || !cur.mesh) return;
      let x = 0, y = 0, z = 0, p = as;
      // thứ tự x, y, z thường cố định; vẫn đọc theo tên cho chắc
      while (p < ae) { while (p < ae && u8[p] !== EQ) p++; if (p >= ae) break; const nm = u8[p - 1]; const q = u8[p + 1]; let s = p + 2, e = s; while (e < ae && u8[e] !== q) e++; const v = parseNum(u8, s, e); if (nm === 120) x = v; else if (nm === 121) y = v; else if (nm === 122) z = v; p = e + 1; }
      cur.mesh.v.push(x); cur.mesh.v.push(y); cur.mesh.v.push(z);
    } else if (isName(u8, ns, ne, 'triangle')) {
      if (!cur || !cur.mesh) return;
      let a = 0, b = 0, c = 0, p = as;
      while (p < ae) { while (p < ae && u8[p] !== EQ) p++; if (p >= ae) break; const nm = u8[p - 1], pre = u8[p - 2]; const q = u8[p + 1]; let s = p + 2, e = s; while (e < ae && u8[e] !== q) e++; const v = parseNum(u8, s, e); if (pre === 118) { if (nm === 49) a = v; else if (nm === 50) b = v; else if (nm === 51) c = v; } p = e + 1; }
      cur.mesh.t.push(a); cur.mesh.t.push(b); cur.mesh.t.push(c);
    } else if (isName(u8, ns, ne, 'object')) {
      const at = attrs(u8, as, ae), id = at.has('id') ? dec(...at.get('id')) : String(objects.size);
      cur = { id, components: [], mesh: null }; objects.set(id, cur);
    } else if (isName(u8, ns, ne, 'mesh')) {
      if (cur) cur.mesh = { v: new Grow(Float64Array), t: new Grow(Uint32Array) };
    } else if (isName(u8, ns, ne, 'component')) {
      if (!cur) return;
      const at = attrs(u8, as, ae);
      cur.components.push({ id: at.has('objectid') ? dec(...at.get('objectid')) : null, path: at.has('p:path') ? dec(...at.get('p:path')) : null, tf: at.has('transform') ? parseTransform(dec(...at.get('transform'))) : null });
    } else if (isName(u8, ns, ne, 'item')) {
      const at = attrs(u8, as, ae);
      if (at.has('printable') && dec(...at.get('printable')) === '0') return;
      items.push({ id: at.has('objectid') ? dec(...at.get('objectid')) : null, tf: at.has('transform') ? parseTransform(dec(...at.get('transform'))) : null });
    } else if (isName(u8, ns, ne, 'model')) {
      const at = attrs(u8, as, ae); if (at.has('unit')) unit = dec(...at.get('unit'));
    }
  });
  for (const o of objects.values()) if (o.mesh) o.mesh = { v: o.mesh.v.out(), t: o.mesh.t.out() };
  return { objects, items, unit };
}

const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

// Trả về { pos: Float32Array (9 số/mặt, mm), objects, tris }
export async function read3mf(arrayBuffer, progress = () => {}) {
  const buf = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const entries = listZip(buf);
  let mainName = [...entries.keys()].find((k) => k.toLowerCase() === '3d/3dmodel.model');
  if (!mainName) mainName = [...entries.keys()].find((k) => k.toLowerCase().endsWith('.model'));
  if (!mainName) throw new Error('file 3MF không có phần mô hình 3D');
  progress('Đang giải nén 3MF...');
  const main = parseModel(await readZipEntry(buf, entries, mainName));
  const scale = UNIT_MM[main.unit] || 1;
  const cache = new Map([[mainName, main]]);
  const getFile = async (path) => {
    const name = path.replace(/^\//, '');
    const key = [...entries.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key) throw new Error('thiếu tệp tham chiếu “' + path + '”');
    if (!cache.has(key)) { progress('Đang đọc ' + key + '...'); cache.set(key, parseModel(await readZipEntry(buf, entries, key))); }
    return cache.get(key);
  };
  const out = new Grow(Float32Array, 1 << 20);
  let objectsUsed = 0;
  const emit = (mesh, tf) => {
    const v = mesh.v, t = mesh.t, flip = (tf[0] * (tf[4] * tf[8] - tf[5] * tf[7]) - tf[1] * (tf[3] * tf[8] - tf[5] * tf[6]) + tf[2] * (tf[3] * tf[7] - tf[4] * tf[6])) < 0;
    const P = new Float32Array(v.length);
    for (let i = 0; i < v.length; i += 3) { const x = v[i], y = v[i + 1], z = v[i + 2]; P[i] = (x * tf[0] + y * tf[3] + z * tf[6] + tf[9]) * scale; P[i + 1] = (x * tf[1] + y * tf[4] + z * tf[7] + tf[10]) * scale; P[i + 2] = (x * tf[2] + y * tf[5] + z * tf[8] + tf[11]) * scale; }
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = (flip ? t[i + 2] : t[i + 1]) * 3, c = (flip ? t[i + 1] : t[i + 2]) * 3;
      if (a + 2 >= P.length || b + 2 >= P.length || c + 2 >= P.length) continue;
      for (const q of [a, b, c]) { out.push(P[q]); out.push(P[q + 1]); out.push(P[q + 2]); }
    }
  };
  const walk = async (file, id, tf, depth) => {
    if (depth > 8) throw new Error('cấu trúc thành phần 3MF lồng quá sâu');
    const o = file.objects.get(id);
    if (!o) return;
    if (o.mesh && o.mesh.t.length) { emit(o.mesh, tf); objectsUsed++; }
    for (const c of o.components) {
      const f = c.path ? await getFile(c.path) : file;
      await walk(f, c.id, compose(c.tf || IDENT, tf), depth + 1);
    }
  };
  progress('Đang đọc lưới...');
  const roots = main.items.length ? main.items : [...main.objects.keys()].map((id) => ({ id, tf: null }));
  for (const it of roots) await walk(main, it.id, it.tf || IDENT, 0);
  const pos = out.out();
  if (pos.length < 36) throw new Error('file 3MF không chứa mặt tam giác nào');
  return { pos: Float32Array.from(pos), objects: objectsUsed, tris: pos.length / 9 };
}
