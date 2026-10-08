import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import {
  cleanGeometry, orientPhoi, phoiStats, countOpenEdges, prepareFaces,
  analyzeDraft, bestTheta, buildMold, buildCasing, plasterCalc,
  analyzeDraftAngles, bestLayout,
} from './mold.js';
import { twistedVase } from './sample.js';
import { buildShell, invertPhoi } from './shell.js';
import { colorDiff, otsu, makeMask, extractProfile, latheFromProfile, profileIoU, reliefFromImage } from './photo.js';

const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value) || 0;
const fmt = (v, d = 0) => v.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });

// ---------- Cảnh 3D ----------
const view = $('view');
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  view.appendChild(renderer.domElement);
} catch (e) {
  const m = document.createElement('div');
  m.style.cssText = 'padding:24px;color:#b3261e';
  m.textContent = 'Trình duyệt này không bật được WebGL nên không hiện được 3D. Hãy mở file bằng Chrome hoặc Safari trực tiếp (không mở trong khung xem trước của ứng dụng khác).';
  view.appendChild(m);
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4efe8);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
camera.position.set(300, 250, 380);
const controls = new OrbitControls(camera, renderer ? renderer.domElement : view);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x998877, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(200, 400, 250);
scene.add(sun);
const grid = new THREE.GridHelper(600, 30, 0xb9a995, 0xdccfbf);
scene.add(grid);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (renderer) renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();
(function loop() { controls.update(); if (renderer) renderer.render(scene, camera); requestAnimationFrame(loop); })();

function fitCamera(r, cy) {
  controls.target.set(0, cy, 0);
  camera.position.set(r * 2.2, cy + r * 1.3, r * 2.8);
  grid.scale.setScalar(Math.max(1, r / 150));
}

// ---------- Trạng thái ----------
let baseGeo = null;     // phôi gốc (đơn vị file)
let phoi = null;        // phôi đã xoay, đổi đơn vị, bù co ngót
let faces = null;
let draft = null;
let mold = null;
let phoiMesh = null;
const moldGroup = new THREE.Group();
scene.add(moldGroup);
let pourManual = false;

const status = (t, err) => { $('status').textContent = t; $('status').className = err ? 'err' : ''; };

// ---------- Nạp phôi ----------
function setBase(geo, name) {
  baseGeo = cleanGeometry(geo);
  rot.x = 0; rot.z = 0;
  pourManual = false;
  $('fileName').textContent = name;
  rebuildPhoi(true);
}

function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'stl' && ext !== 'obj') return status('Chỉ nhận file .stl hoặc .obj', true);
  const reader = new FileReader();
  reader.onload = () => {
    try {
      let geo;
      if (ext === 'stl') geo = new STLLoader().parse(reader.result);
      else if (ext === 'obj') {
        const gs = [];
        new OBJLoader().parse(reader.result).traverse((o) => { if (o.isMesh) gs.push(o.geometry.index ? o.geometry.toNonIndexed() : o.geometry); });
        if (!gs.length) throw new Error('File OBJ không có mặt tam giác');
        geo = mergeGeos(gs);
      } else throw new Error('Chỉ nhận file .stl hoặc .obj');
      setBase(geo, file.name);
    } catch (e) { status('Lỗi đọc file: ' + e.message, true); }
  };
  if (ext === 'obj') reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

function mergeGeos(gs) {
  let total = 0;
  gs.forEach((g) => (total += g.attributes.position.count));
  const arr = new Float32Array(total * 3);
  let o = 0;
  gs.forEach((g) => { arr.set(g.attributes.position.array, o); o += g.attributes.position.count * 3; });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return out;
}

$('file').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
const drop = $('view');
drop.addEventListener('dragover', (e) => e.preventDefault());
drop.addEventListener('drop', (e) => { e.preventDefault(); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); });

$('demoTwist').addEventListener('click', () => setBase(twistedVase(), 'Bình xoắn mẫu (demo)'));
$('dlSample').addEventListener('click', () => download(new THREE.Mesh(twistedVase()), 'binh_xoan_mau.stl'));

$('demo').addEventListener('click', () => {
  const prof = [[0, 0], [28, 0], [34, 6], [48, 40], [52, 70], [44, 110], [26, 140], [22, 160], [26, 172], [26, 180], [0, 180]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  setBase(new THREE.LatheGeometry(prof, 64), 'Bình mẫu (demo)');
});

const rot = { x: 0, z: 0 };
$('rotX').addEventListener('click', () => { rot.x = (rot.x + 90) % 360; rebuildPhoi(true); });
$('rotZ').addEventListener('click', () => { rot.z = (rot.z + 90) % 360; rebuildPhoi(true); });
$('pourR').addEventListener('input', () => (pourManual = true));

// ---------- Dựng phôi + kiểm tra góc thoát ----------
function clearMold() {
  while (moldGroup.children.length) {
    const m = moldGroup.children.pop();
    m.geometry.dispose();
  }
  mold = null;
  $('moldInfo').innerHTML = '<span class="muted">Chưa tạo khuôn. Chỉnh thông số rồi bấm “Tạo khuôn”.</span>';
  ['dlAll'].forEach((id) => ($(id).disabled = true));
  $('dlPieces').innerHTML = '';
  $('dlCasings').innerHTML = '<span class="muted">Tạo khuôn dạng hộp để có hộp đổ.</span>';
  $('plasterInfo').innerHTML = '';
}

function rebuildPhoi(refit) {
  if (!baseGeo) return;
  clearMold();
  const unit = num('unit') || 1;
  phoi = orientPhoi(baseGeo, { unit, rx: rot.x, rz: rot.z, shrink: num('shrink') / 100 });
  const st = phoiStats(phoi);
  faces = prepareFaces(phoi);
  const open = countOpenEdges(phoi);
  const fired = orientPhoi(baseGeo, { unit, rx: rot.x, rz: rot.z, shrink: 0 });
  const fs = phoiStats(fired).size;
  $('phoiInfo').innerHTML =
    `Phôi in (đã bù co ngót): <b>${fmt(st.size[0])} × ${fmt(st.size[2])} × ${fmt(st.size[1], 0)} mm</b> (rộng × sâu × cao)<br>` +
    `Sản phẩm sau nung: ${fmt(fs[0])} × ${fmt(fs[2])} × ${fmt(fs[1])} mm<br>` +
    `Thể tích phôi: ${fmt(st.volume / 1000, 1)} cm³ · ${fmt(st.tris)} mặt` +
    (open ? `<br><span class="warn">⚠ Lưới phôi hở/không kín (${open} cạnh). Cần sửa trong Blender/Meshmixer (Make Manifold) nếu tạo khuôn lỗi.</span>` : '<br><span class="ok">✓ Lưới kín, dùng được.</span>') +
    (st.tris > 150000 ? '<br><span class="warn">⚠ Quá nhiều mặt, tạo khuôn sẽ chậm. Nên giảm mặt (Decimate) về dưới 100k.</span>' : '');
  if (!pourManual) {
    let re = 0;
    const p = phoi.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > st.H * 0.95) re = Math.max(re, Math.hypot(p.getX(i), p.getZ(i)));
    $('pourR').value = Math.max(5, Math.round((re || st.rmax * 0.4) * 0.6));
    $('shPour').value = $('pourR').value;
  }
  modeRefresh();
  if (refit) fitCamera(Math.max(st.rmax, st.H / 2), st.H / 2);
}

function updateDraft() {
  if (!phoi) return;
  const n = parseInt($('n').value);
  $('theta').max = 360 / n;
  if (parseFloat($('theta').value) > 360 / n) $('theta').value = 0;
  const th = parseFloat($('theta').value);
  $('thetaVal').textContent = th + '°';
  draft = analyzeDraft(faces, n, th, num('minDraft'));
  const tot = draft.area[0] + draft.area[1] + draft.area[2] || 1;
  const pc = (i) => fmt((draft.area[i] / tot) * 100, 1) + '%';
  $('draftInfo').innerHTML =
    `<span class="dot g"></span>Thoát tốt ${pc(0)} &nbsp; <span class="dot y"></span>Ít góc thoát ${pc(1)} &nbsp; <span class="dot r"></span>Undercut ${pc(2)}` +
    (draft.area[2] / tot > 0.002
      ? '<br><span class="warn">⚠ Có vùng undercut: mảnh khuôn sẽ kẹt khi tháo. Thử “Tự tìm góc chia”, tăng số mảnh, hoặc sửa lại phôi (xem vùng đỏ).</span>'
      : '<br><span class="ok">✓ Không có undercut theo hướng kéo của các mảnh.</span>');
  drawPhoi();
}

function drawPhoi() {
  if (phoiMesh) { scene.remove(phoiMesh); phoiMesh.geometry.dispose(); }
  const g = phoi.toNonIndexed();
  const col = new Float32Array(g.attributes.position.count * 3);
  const C = [[0.35, 0.72, 0.4], [0.95, 0.78, 0.2], [0.88, 0.2, 0.18]];
  const neutral = [0.86, 0.8, 0.72];
  const useDraft = $('showDraft').checked;
  for (let t = 0; t < draft.cls.length; t++) {
    const c = useDraft ? C[draft.cls[t]] : neutral;
    for (let v = 0; v < 3; v++) col.set(c, (3 * t + v) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  phoiMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }));
  scene.add(phoiMesh);
  applyVisibility();
}

function applyVisibility() {
  if (phoiMesh) phoiMesh.visible = !shellMode && !imgMode && $('showPhoi').checked;
  moldGroup.visible = !shellMode && !imgMode && $('showMold').checked;
  moldGroup.children.forEach((m) => {
    m.material.transparent = $('showPhoi').checked;
    m.material.opacity = $('showPhoi').checked ? 0.35 : 1;
    m.material.depthWrite = !$('showPhoi').checked;
    m.material.needsUpdate = true;
  });
}

function applyExplode() {
  if (!mold) return;
  const d = (num('explode') / 100) * mold.R * 1.1;
  moldGroup.children.forEach((m) => m.position.set(Math.cos(m.userData.mid) * d, 0, Math.sin(m.userData.mid) * d));
}

// ---------- Tạo khuôn ----------
const COLORS = [0xd9a066, 0x8fb8a8, 0xc98a8a, 0x9fa6d6, 0xd6c46f, 0xb8a1c9];

$('build').addEventListener('click', () => {
  if (!phoi) return status('Hãy tải phôi (STL/OBJ) hoặc bấm “Bình mẫu” trước.', true);
  const o = {
    shape: boxMode() ? 'box' : 'round', n: parseInt($('n').value), theta0: num('theta'), wall: num('wall'), base: num('base'),
    spare: Math.max(5, num('spare')), pourR: num('pourR'), keys: $('keys').checked, tol: num('tol'),
  };
  if (o.wall < 10) return status('Thành khuôn nên từ 10 mm trở lên.', true);
  clearMold();
  $('build').disabled = true;
  status('Đang tạo khuôn...');
  setTimeout(() => {
    try {
      const t0 = performance.now();
      mold = buildMold(phoi, o, status);
      mold.pieces.forEach((p, i) => {
        p.geometry.computeBoundingSphere();
        const m = new THREE.Mesh(p.geometry, new THREE.MeshStandardMaterial({ color: COLORS[i % COLORS.length], roughness: 0.9 }));
        m.userData.mid = p.mid;
        moldGroup.add(m);
      });
      applyVisibility();
      applyExplode();
      showMoldInfo();
      fitCamera(Math.max(mold.R, (mold.top - mold.bottom) / 2), (mold.top + mold.bottom) / 2);
      status(`Xong trong ${fmt((performance.now() - t0) / 1000, 1)} giây.`);
    } catch (e) {
      console.error(e);
      clearMold();
      status('Tạo khuôn lỗi: ' + e.message + '. Thường do lưới phôi không kín hoặc quá nhiều mặt.', true);
    }
    $('build').disabled = false;
  }, 30);
});

const boxMode = () => $('shape').value === 'box' && $('n').value === '2';

function syncShape() {
  const two = $('n').value === '2';
  $('shape').querySelector('option[value=box]').disabled = !two;
  if (!two) $('shape').value = 'round';
}

function showMoldInfo() {
  const total = mold.pieces.reduce((s, p) => s + p.volume, 0);
  const dim = mold.shape === 'box'
    ? `khối hộp ${fmt(mold.dims.W)} × ${fmt(mold.dims.T)} × ${fmt(mold.dims.H)} mm / mảnh`
    : `khuôn tròn Ø${fmt(mold.dims.D)} × cao ${fmt(mold.dims.H)} mm`;
  $('moldInfo').innerHTML =
    `${mold.pieces.length} mảnh · ${dim}<br>` +
    `Thể tích thạch cao: <b>${fmt(total / 1e6, 2)} lít</b>`;
  $('dlAll').disabled = false;
  $('dlPieces').innerHTML = '';
  mold.pieces.forEach((p, i) => {
    const b = document.createElement('button');
    b.textContent = `Mảnh ${i + 1}`;
    b.addEventListener('click', () => download(new THREE.Mesh(p.geometry), `khuon_manh${i + 1}.stl`));
    $('dlPieces').appendChild(b);
  });
  $('dlCasings').innerHTML = '';
  if (mold.shape === 'box') {
    mold.pieces.forEach((p, i) => {
      const b = document.createElement('button');
      b.textContent = `Hộp đổ mảnh ${i + 1}`;
      b.addEventListener('click', () => {
        b.disabled = true; status(`Đang tạo hộp đổ mảnh ${i + 1}...`);
        setTimeout(() => {
          try {
            const c = buildCasing(mold, i);
            download(new THREE.Mesh(c.geometry), `hop_do_manh${i + 1}.stl`);
            status(`Hộp đổ mảnh ${i + 1}: ${fmt(c.size[0])} × ${fmt(c.size[2])} × ${fmt(c.size[1])} mm, khoảng ${fmt(c.volume / 1000)} cm³ nhựa đặc (slicer sẽ để rỗng bớt). Đặt mặt sàn xuống bàn in, đổ thạch cao tới mép tường.`);
          } catch (e) { console.error(e); status('Tạo hộp đổ lỗi: ' + e.message, true); }
          b.disabled = false;
        }, 30);
      });
      $('dlCasings').appendChild(b);
    });
  } else $('dlCasings').innerHTML = '<span class="muted">Chỉ có khi chọn 2 mảnh dạng hộp chữ nhật.</span>';
  showPlaster();
}

function showPlaster() {
  if (!mold) return;
  const total = mold.pieces.reduce((s, p) => s + p.volume, 0);
  const c = plasterCalc(total, num('ratio') / 100, num('waste'));
  $('plasterInfo').innerHTML =
    `Hồ cần pha: <b>${fmt(c.slurryMl)} ml</b><br>` +
    `Thạch cao: <b>${fmt(c.plasterG)} g</b> (${fmt(c.plasterG / 1000, 2)} kg)<br>` +
    `Nước: <b>${fmt(c.waterMl)} ml</b><br>` +
    `<span class="muted">Tính theo khối lượng: ${fmt(num('ratio'))} nước : 100 thạch cao, hao hụt ${fmt(num('waste'))}%. Đây là con số ước tính, hãy pha thêm theo kinh nghiệm xưởng.</span>`;
}

// ---------- Xuất STL ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// Gói file thành .zip (không nén) vì trang web chỉ cho tải một số đuôi file, không có .stl
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 33, true); lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 33, true); ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + n;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

async function download(mesh, name) {
  const dv = new STLExporter().parse(mesh, { binary: true });
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  let dl = null;
  try { dl = window.claude && (await window.claude.use('downloads')); } catch (e) { dl = null; }
  if (dl) {
    // Trang chạy trong khung bảo vệ: phải tải qua hộp xác nhận, và chỉ nhận file .zip
    try {
      await dl.save({ filename: name.replace(/\.stl$/i, '') + '.zip', data: makeZip([{ name, data: bytes }]) });
      status('Đã lưu file .zip. Giải nén ra sẽ có ' + name);
    } catch (e) { if (e.code !== 'declined') status('Không lưu được file: ' + (e.message || e.code), true); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'model/stl' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function downloadMany(zipName, items) {
  const files = items.map((it) => {
    const dv = new STLExporter().parse(it.mesh, { binary: true });
    return { name: it.name, data: new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength) };
  });
  const blob = makeZip(files);
  let dl = null;
  try { dl = window.claude && (await window.claude.use('downloads')); } catch (e) { dl = null; }
  if (dl) {
    try { await dl.save({ filename: zipName, data: blob }); status(`Đã lưu ${zipName}. Giải nén ra sẽ có ${files.length} file STL.`); }
    catch (e) { if (e.code !== 'declined') status('Không lưu được file: ' + (e.message || e.code), true); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('dlPhoi').addEventListener('click', () => phoi && download(new THREE.Mesh(phoi), 'phoi_da_bu_co_ngot.stl'));
$('dlAll').addEventListener('click', () => {
  if (!mold) return;
  const g = new THREE.Group();
  mold.pieces.forEach((p) => g.add(new THREE.Mesh(p.geometry)));
  download(g, 'khuon_tat_ca_manh.stl');
});

// ---------- Sự kiện thông số ----------
['unit', 'shrink'].forEach((id) => $(id).addEventListener('change', () => rebuildPhoi(true)));
['n', 'theta', 'minDraft'].forEach((id) => $(id).addEventListener('input', () => { syncShape(); clearMold(); updateDraft(); }));
$('shape').addEventListener('change', clearMold);
['wall', 'base', 'spare', 'pourR', 'keys', 'tol'].forEach((id) => $(id).addEventListener('change', clearMold));
$('autoTheta').addEventListener('click', () => {
  if (!faces) return;
  const n = parseInt($('n').value);
  $('theta').value = bestTheta(faces, n, num('minDraft'));
  clearMold();
  updateDraft();
});
['showPhoi', 'showMold'].forEach((id) => $(id).addEventListener('change', applyVisibility));
$('showDraft').addEventListener('change', () => phoi && drawPhoi());
$('explode').addEventListener('input', applyExplode);
['ratio', 'waste'].forEach((id) => $(id).addEventListener('input', showPlaster));


// ================== MODULE HỘP BAO CHIA MẢNH ==================
let shellMode = true;
let imgMode = false;
const imGroup = new THREE.Group();
scene.add(imGroup);
let imgGeoMesh = null, imgFit = { r: 100, cy: 90 };
const shellGroup = new THREE.Group();
scene.add(shellGroup);
let shellAngles = [0, 120, 240];
let shellFaces = null, shellDraft = null, shellRes = null, invMesh = null, shellBusy = false, shellTimer = null;
const sh = (id) => num(id);
const shStatus = (t, err) => { $('shStatus').textContent = t; $('shStatus').style.color = err ? 'var(--err)' : ''; };
const PANEL_COLORS = [0xe3b04b, 0xd9893a, 0x8cc47a, 0xe6c86a, 0xcf7a5a, 0x9bb8d9, 0xd6a0c2, 0xa7c957];
const DRAFT_COLORS = [[0.35, 0.72, 0.4], [0.95, 0.78, 0.2], [0.88, 0.2, 0.18]];

function setMode(m) {
  shellMode = m === 'shell';
  imgMode = m === 'img';
  $('modeShell').hidden = !shellMode;
  $('modeBox').hidden = m !== 'box';
  $('modeImg').hidden = !imgMode;
  $('secPhoi').hidden = imgMode;
  $('tabShell').classList.toggle('on', shellMode);
  $('tabBox').classList.toggle('on', m === 'box');
  $('tabImg').classList.toggle('on', imgMode);
  shellGroup.visible = shellMode;
  imGroup.visible = imgMode;
  if (phoi && !imgMode) modeRefresh();
  applyVisibility();
  if (imgMode && imgGeoMesh) fitCamera(imgFit.r, imgFit.cy);
}
$('tabShell').addEventListener('click', () => setMode('shell'));
$('tabBox').addEventListener('click', () => setMode('box'));
$('tabImg').addEventListener('click', () => setMode('img'));

function modeRefresh() {
  if (!phoi || imgMode) return;
  if (shellMode) shellPhoiChanged();
  else { updateDraft(); }
}

function clearShell() {
  while (shellGroup.children.length) { const m = shellGroup.children.pop(); if (m.geometry) m.geometry.dispose(); }
  shellRes = null; invMesh = null;
  $('shInfo').innerHTML = '<span class="muted">Chưa tạo hộp bao. Chỉnh xong bấm “Tạo hộp bao”.</span>';
  $('shDlAll').disabled = true; $('shDlParts').innerHTML = ''; $('shPlaster').innerHTML = ''; $('shGuide').textContent = '';
}

function renderAngles() {
  const box = $('angList');
  box.innerHTML = '';
  shellAngles.forEach((a, i) => {
    const row = document.createElement('div'); row.className = 'angrow';
    const lab = document.createElement('span'); lab.textContent = `Vách ${i + 1}`;
    const inp = document.createElement('input'); inp.type = 'number'; inp.step = '1'; inp.value = Math.round(a * 10) / 10;
    inp.addEventListener('change', () => { shellAngles[i] = ((parseFloat(inp.value) || 0) % 360 + 360) % 360; shellAnglesChanged(); });
    const del = document.createElement('button'); del.textContent = 'Xóa';
    del.disabled = shellAngles.length <= 2;
    del.addEventListener('click', () => { shellAngles.splice(i, 1); shellAnglesChanged(); });
    row.append(lab, inp, del); box.appendChild(row);
  });
}

function shellAnglesChanged() {
  shellAngles.sort((a, b) => a - b);
  clearShell();
  renderAngles();
  shellAnalyze();
}

$('angAdd').addEventListener('click', () => {
  const s = [...shellAngles].sort((a, b) => a - b);
  let best = 0, at = 0;
  s.forEach((a, i) => { const e = i + 1 < s.length ? s[i + 1] : s[0] + 360; if (e - a > best) { best = e - a; at = a + (e - a) / 2; } });
  shellAngles.push(Math.round((at % 360) * 10) / 10);
  shellAnglesChanged();
});
$('angEven').addEventListener('change', () => {
  const n = parseInt($('angEven').value);
  if (n) { const t = shellAngles.length ? Math.min(...shellAngles) % (360 / n) : 0; shellAngles = Array.from({ length: n }, (_, i) => t + (i * 360) / n); shellAnglesChanged(); }
  $('angEven').value = '';
});

// phân tích undercut trên phôi đã đảo
function shellAnalyze() {
  if (!phoi) return;
  const inv = invertPhoi(phoi, sh('shSpare'));
  shellFaces = prepareFaces(inv);
  shellDraft = analyzeDraftAngles(shellFaces, shellAngles, sh('shMinDraft'));
  const a = shellDraft.area, tot = a[0] + a[1] + a[2] || 1;
  const pc = (i) => fmt((a[i] / tot) * 100, 1) + '%';
  const spans = shellDraft.sectors.map((s) => fmt(s.span)).join('°, ') + '°';
  let msg = `<span class="dot g"></span>Thoát tốt ${pc(0)} &nbsp; <span class="dot y"></span>Ít góc thoát ${pc(1)} &nbsp; <span class="dot r"></span>Undercut ${pc(2)}<br><span class="muted">${shellAngles.length} mảnh, độ rộng: ${spans}</span>`;
  if (shellDraft.maxSpan > 180.01) msg += '<br><span class="warn">⚠ Có mảnh rộng hơn 180°, không tháo ra được. Thêm vách chia vào khoảng đó.</span>';
  else if (a[2] / tot > 0.002) msg += '<br><span class="warn">⚠ Còn vùng undercut (màu đỏ): mảnh có thể kẹt khi tháo. Thử “Tự phân tích”, thêm vách hoặc dời vách khỏi vùng đỏ.</span>';
  else msg += '<br><span class="ok">✓ Không có undercut theo hướng kéo của các mảnh.</span>';
  $('shDraft').innerHTML = msg;
  $('shBuild').disabled = shellDraft.maxSpan > 180.01 || shellBusy;
  drawInverted(inv);
}

function drawInverted(inv) {
  if (invMesh) { shellGroup.remove(invMesh); invMesh.geometry.dispose(); invMesh = null; }
  if (shellRes) return; // đã có hộp bao: phôi hiển thị trong cụm bung
  invMesh = makePositiveMesh(inv);
  shellGroup.add(invMesh);
  if (!shellRes) fitShell(phoiStats(phoi).rmax + sh('shWall'), (phoiStats(phoi).H + sh('shSpare')) / 2);
}

function makePositiveMesh(inv) {
  const g = inv.toNonIndexed();
  const col = new Float32Array(g.attributes.position.count * 3);
  const neutral = [0.86, 0.8, 0.72], use = $('shShowDraft').checked && shellDraft;
  for (let t = 0; t < g.attributes.position.count / 3; t++) {
    const c = use ? DRAFT_COLORS[shellDraft.cls[t]] : neutral;
    for (let v = 0; v < 3; v++) col.set(c, (3 * t + v) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }));
  m.userData = { kind: 'phoi', mid: 0 };
  return m;
}

function fitShell(r, cy) { fitCamera(r, cy); }

function shellPhoiChanged() {
  clearShell();
  const st = phoiStats(phoi);
  $('shSpare').value = $('shSpare').value || 25;
  if ($('shAutoOn').checked) {
    shStatus('Đang phân tích phôi...');
    setTimeout(() => {
      shellAnalyze0(); // dựng khung phân tích cho bestLayout
      const b = bestLayout(shellFaces, sh('shMinDraft'));
      shellAngles = b.angles.map((x) => Math.round(x * 10) / 10);
      renderAngles();
      shellAnalyze();
      shellBuildNow();
    }, 30);
  } else {
    shellAnalyze();
    renderAngles();
    shStatus('');
  }
  void st;
}
function shellAnalyze0() { shellFaces = prepareFaces(invertPhoi(phoi, sh('shSpare'))); }

$('shAuto').addEventListener('click', () => {
  if (!phoi) return shStatus('Hãy tải phôi trước.', true);
  clearShell();
  shStatus('Đang phân tích phôi...');
  setTimeout(() => {
    shellAnalyze0();
    const b = bestLayout(shellFaces, sh('shMinDraft'));
    shellAngles = b.angles.map((x) => Math.round(x * 10) / 10);
    renderAngles(); shellAnalyze(); shellBuildNow();
  }, 30);
});
$('shBuild').addEventListener('click', () => shellBuildNow());
$('shShowDraft').addEventListener('change', () => { if (phoi && !shellRes) shellAnalyze(); });
['shWall', 'shShell', 'shDiv', 'shGap', 'shSpare', 'shPour', 'shBase', 'shKey'].forEach((id) => $(id).addEventListener('change', () => { clearShell(); shellAnalyze(); }));
$('shMinDraft').addEventListener('change', () => { clearShell(); shellAnalyze(); });

function shellBuildNow() {
  if (!phoi || shellBusy) return;
  if (shellDraft && shellDraft.maxSpan > 180.01) return shStatus('Có mảnh rộng hơn 180°, hãy thêm vách chia.', true);
  shellBusy = true; $('shBuild').disabled = true; $('shAuto').disabled = true;
  const o = {
    angles: [...shellAngles].sort((a, b) => a - b), wall: sh('shWall'), shell: sh('shShell'), divider: sh('shDiv'), gap: sh('shGap'),
    spare: Math.max(8, sh('shSpare')), pourR: sh('shPour'), base: sh('shBase'), keyR: sh('shKey'), clear: sh('shGap'),
  };
  setTimeout(() => {
    try {
      const t0 = performance.now();
      const r = buildShell(phoi, o, (m) => shStatus(m));
      showShell(r, o);
      shStatus(`Xong trong ${fmt((performance.now() - t0) / 1000, 1)} giây.`);
    } catch (e) {
      console.error(e);
      shStatus('Tạo hộp bao lỗi: ' + e.message + '. Thường do lưới phôi không kín, quá nhiều mặt, hoặc thông số quá nhỏ.', true);
    }
    shellBusy = false; $('shBuild').disabled = false; $('shAuto').disabled = false;
  }, 30);
}

const KIND_COLOR = { divider: 0xd0382c, base: 0x4fb6a0 };
function showShell(r, o) {
  while (shellGroup.children.length) { const m = shellGroup.children.pop(); if (m.geometry) m.geometry.dispose(); }
  invMesh = null;
  shellRes = { r, o };
  let pi = 0;
  r.parts.forEach((p) => {
    if (p.kind === 'phoi') return;
    const color = p.kind === 'panel' ? PANEL_COLORS[pi++ % PANEL_COLORS.length] : KIND_COLOR[p.kind];
    const m = new THREE.Mesh(p.geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide }));
    m.userData = { kind: p.kind, mid: p.mid };
    shellGroup.add(m);
  });
  const inv = invertPhoi(phoi, o.spare);
  const pm = makePositiveMesh(inv);
  shellGroup.add(pm);
  const sp = new THREE.Mesh(new THREE.CylinderGeometry(o.pourR, o.pourR, o.spare, 48), new THREE.MeshStandardMaterial({ color: 0xcfc4b3, roughness: 0.8 }));
  sp.position.y = o.spare / 2; sp.userData = { kind: 'phoi', mid: 0 };
  shellGroup.add(sp);
  applyShellView();
  $('shExplode').value = 0;
  fitShell(Math.max(r.dims.D / 2, r.dims.H / 2), r.dims.H / 2);

  const nP = r.parts.filter((p) => p.kind === 'panel').length, nD = r.parts.filter((p) => p.kind === 'divider').length;
  $('shInfo').innerHTML =
    `<span class="sw" style="background:#4fb6a0"></span>1 đế · <span class="sw" style="background:#d0382c"></span>${nD} vách chia · <span class="sw" style="background:#e3b04b"></span>${nP} vỏ ngoài<br>` +
    `Hộp bao Ø${fmt(r.dims.D)} × cao ${fmt(r.dims.H)} mm. Chia ${nD} mảnh thạch cao.`;
  showShellPlaster();
  $('shDlAll').disabled = false;
  const box = $('shDlParts'); box.innerHTML = '';
  r.parts.forEach((p) => {
    const b = document.createElement('button'); b.textContent = p.label;
    b.addEventListener('click', () => download(new THREE.Mesh(p.geometry), p.name + '.stl'));
    box.appendChild(b);
  });
  $('shGuide').innerHTML = `Cách dùng: in cuống + phôi đảo ngược, đế, vách và vỏ. Đặt phôi lên đế, cắm các vách chia vào sát phôi, ghép vỏ ngoài vào giữa các vách và buộc dây thun. Trét kín mối nối bằng đất sét, rồi đổ thạch cao tới ${fmt(r.yTop)} mm. Chấm tròn trên vách tạo lỗ lõm trên thạch cao: đặt viên đất sét hoặc bi nhỏ vào làm chốt định vị khi ghép khuôn.`;
}

function showShellPlaster() {
  if (!shellRes) return;
  const c = plasterCalc(shellRes.r.plasterMm3, sh('shRatio') / 100, sh('shWaste'));
  $('shPlaster').innerHTML =
    `Thạch cao đặc: <b>${fmt(shellRes.r.plasterMm3 / 1e6, 2)} lít</b> · Hồ cần pha: <b>${fmt(c.slurryMl)} ml</b><br>` +
    `Thạch cao: <b>${fmt(c.plasterG)} g</b> (${fmt(c.plasterG / 1000, 2)} kg) · Nước: <b>${fmt(c.waterMl)} ml</b><br>` +
    `<span class="muted">Tỉ lệ ${fmt(sh('shRatio'))} nước : 100 thạch cao, hao hụt ${fmt(sh('shWaste'))}%. Ước tính, pha dư một chút theo kinh nghiệm xưởng.</span>`;
}
['shRatio', 'shWaste'].forEach((id) => $(id).addEventListener('input', showShellPlaster));

function applyShellView() {
  const hideP = !$('shShowPanel').checked;
  shellGroup.children.forEach((m) => { if (m.userData.kind === 'panel') m.visible = !hideP; });
}
function applyShellExplode() {
  if (!shellRes) return;
  const d = (sh('shExplode') / 100) * shellRes.r.dims.D * 0.7;
  shellGroup.children.forEach((m) => {
    const k = m.userData.kind, mid = m.userData.mid || 0;
    if (k === 'panel') m.position.set(Math.cos(mid) * d, 0, Math.sin(mid) * d);
    else if (k === 'divider') m.position.set(Math.cos(mid) * d * 0.45, 0, Math.sin(mid) * d * 0.45);
    else if (k === 'base') m.position.set(0, -d * 0.35, 0);
    else if (k === 'phoi') m.position.set(0, d * 0.5, 0);
  });
}
$('shShowPanel').addEventListener('change', applyShellView);
$('shExplode').addEventListener('input', applyShellExplode);
$('shDlAll').addEventListener('click', () => {
  if (!shellRes) return;
  const items = shellRes.r.parts.map((p) => ({ name: p.name + '.stl', mesh: new THREE.Mesh(p.geometry) }));
  downloadMany('hop_bao_khuon.zip', items);
});


// ================== MODULE ẢNH → PHÔI ==================
let im = null;          // { img: {data,width,height}, diff, auto, name }
let imGeo = null, imKind = 'lathe', imBusy = null;
const imCanvas = $('imCanvas');

async function imLoad(file) {
  try {
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) {
      bmp = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Không đọc được ảnh')); i.src = URL.createObjectURL(file); });
    }
    const sc = Math.min(1, 1100 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    imSet(c.getContext('2d').getImageData(0, 0, c.width, c.height), file.name);
  } catch (e) { $('imInfo').innerHTML = `<span class="warn">Lỗi đọc ảnh: ${e.message}</span>`; }
}

function imSet(img, name) {
  const diff = colorDiff(img);
  im = { img, diff, auto: otsu(diff), name };
  $('imThr').value = Math.min(140, Math.max(6, im.auto));
  $('imName').textContent = `${name} · ${img.width}×${img.height} px`;
  imProcess();
}

// ảnh mẫu: bình chụp trên nền sáng, có bóng đổ nhẹ
function sampleImage() {
  const W = 640, H = 960, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#ebebe7'); bg.addColorStop(1, '#d4d4d0');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  const prof = [[0, 38], [0.06, 44], [0.17, 50], [0.33, 48], [0.53, 36], [0.72, 24], [0.86, 20], [0.94, 22], [1, 24]];
  const rAt = (t) => { for (let i = 0; i < prof.length - 1; i++) if (t <= prof[i + 1][0]) { const u = (t - prof[i][0]) / (prof[i + 1][0] - prof[i][0]); return prof[i][1] + (prof[i + 1][1] - prof[i][1]) * u * u * (3 - 2 * u); } return 24; };
  const top = 90, bot = 880, cx = 305, k = 3;
  x.fillStyle = 'rgba(0,0,0,.12)'; x.beginPath(); x.ellipse(cx + 25, bot + 8, 150, 14, 0, 0, 7); x.fill();
  const g = x.createLinearGradient(cx - 160, 0, cx + 160, 0);
  g.addColorStop(0, '#6b4a33'); g.addColorStop(0.35, '#c79566'); g.addColorStop(0.6, '#b07c52'); g.addColorStop(1, '#5a3d2a');
  x.fillStyle = g; x.beginPath();
  for (let y = bot; y >= top; y -= 4) { const r = rAt((bot - y) / (bot - top)) * k; if (y === bot) x.moveTo(cx - r, y); else x.lineTo(cx - r, y); }
  for (let y = top; y <= bot; y += 4) x.lineTo(cx + rAt((bot - y) / (bot - top)) * k, y);
  x.closePath(); x.fill();
  return x.getImageData(0, 0, W, H);
}

function imProcess() {
  if (!im) return;
  imKind = $('imType').value;
  $('imLathe').hidden = imKind !== 'lathe';
  $('imRelief').hidden = imKind !== 'relief';
  $('imThrVal').textContent = $('imThr').value;
  const { img } = im, w = img.width, h = img.height;
  try {
    let geo, info = '';
    const ctx = imCanvas.getContext('2d');
    imCanvas.width = w; imCanvas.height = h;
    ctx.putImageData(img, 0, 0);
    if (imKind === 'lathe') {
      const mask = makeMask(im.diff, w, h, num('imThr'));
      const prof = extractProfile(mask, w, h, { heightMm: num('imH'), side: $('imSide').value, smooth: num('imSmooth') });
      geo = latheFromProfile(prof);
      const iou = profileIoU(mask, w, prof);
      // vẽ đường viền mô hình lên ảnh gốc
      ctx.lineWidth = Math.max(2, w / 300); ctx.strokeStyle = '#e03a2e';
      ctx.beginPath(); prof.px.forEach((r, i) => { const px = prof.xc - r, py = prof.ys[i]; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      ctx.beginPath(); prof.px.forEach((r, i) => { const px = prof.xc + r, py = prof.ys[i]; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke();
      ctx.setLineDash([10, 8]); ctx.strokeStyle = '#2a8cd6'; ctx.beginPath(); ctx.moveTo(prof.xc, prof.y0); ctx.lineTo(prof.xc, prof.y1); ctx.stroke(); ctx.setLineDash([]);
      const maxR = Math.max(...prof.r);
      info = `Đường đỏ là đường viền mô hình, vẽ đè lên ảnh. Độ khớp đường viền với ảnh: <b>${fmt(iou * 100, 2)}%</b><br>` +
        `Cao ${fmt(num('imH'))} mm · rộng lớn nhất <b>${fmt(maxR * 2, 1)} mm</b> · ${fmt(prof.r.length)} điểm đường viền.<br>` +
        (iou < 0.97 ? '<span class="warn">⚠ Độ khớp thấp: vật có thể không đối xứng, ảnh bị nghiêng, hoặc tách nền chưa đúng. Chỉnh “Độ nhạy tách nền” hoặc thử lấy một bên.</span>' : '<span class="ok">✓ Đường viền khớp ảnh.</span>');
      $('imNote').textContent = 'Độ khớp đo trên chính ảnh này (đường viền 2D). Phần khuất không có trong ảnh nên thân được coi là tròn xoay.';
    } else {
      const r = reliefFromImage(img, { widthMm: num('imW'), depthMm: num('imDepth'), baseMm: num('imBase'), invert: !$('imBright').checked, gamma: 100 / num('imGamma'), blur: num('imBlur'), cut: $('imCut').checked, thr: num('imThr') || null, gridW: 160 });
      geo = r.geometry;
      const hc = document.createElement('canvas'); hc.width = r.gw; hc.height = r.gh;
      const hx = hc.getContext('2d'), id = hx.createImageData(r.gw, r.gh);
      for (let i = 0; i < r.hgt.length; i++) { const v = Math.round(r.hgt[i] * 255); id.data.set([v, v, v, 255], i * 4); }
      hx.putImageData(id, 0, 0);
      imCanvas.width = w * 2 + 12; imCanvas.height = h; ctx.fillStyle = '#888'; ctx.fillRect(0, 0, imCanvas.width, h);
      ctx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(hc, w + 12, 0, w, h);
      const bb = new THREE.Box3().setFromBufferAttribute(geo.attributes.position), sz = bb.getSize(new THREE.Vector3());
      info = `Trái: ảnh gốc. Phải: bản đồ độ cao (sáng = nổi).<br>Phôi ${fmt(sz.x)} × ${fmt(sz.z)} mm, dày ${fmt(sz.y, 1)} mm · ${fmt(geo.index.count / 3)} mặt.`;
      $('imNote').textContent = 'Độ cao suy ra từ độ sáng tối, không phải độ sâu thật. Hợp với tranh và phù điêu in đơn sắc; cần chỉnh tay chi tiết quan trọng.';
    }
    imGeo = geo;
    $('imInfo').innerHTML = info;
    $('imUse').disabled = imKind !== 'lathe'; $('imDl').disabled = false;
    imShow(geo);
  } catch (e) { imGeo = null; $('imInfo').innerHTML = `<span class="warn">${e.message}</span>`; $('imUse').disabled = true; $('imDl').disabled = true; }
}

function imShow(geo) {
  while (imGroup.children.length) { const m = imGroup.children.pop(); m.geometry.dispose(); }
  const g = geo.clone(); g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, imKind === 'lathe' ? 0 : -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingBox();
  imGeoMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd9bfa0, roughness: 0.85 }));
  imGroup.add(imGeoMesh);
  const sz = g.boundingBox.getSize(new THREE.Vector3());
  imFit = { r: Math.max(sz.x, sz.z, sz.y) * 0.6, cy: sz.y / 2 };
  if (imMode0()) fitCamera(imFit.r, imFit.cy);
}
const imMode0 = () => imgMode;

$('imPick').addEventListener('click', () => $('imFile').click());
$('imFile').addEventListener('change', (e) => e.target.files[0] && imLoad(e.target.files[0]));
$('imSample').addEventListener('click', () => { imSet(sampleImage(), 'Ảnh mẫu (bình)'); });
['imType', 'imH', 'imSide', 'imSmooth', 'imW', 'imDepth', 'imBase', 'imBright', 'imCut', 'imGamma', 'imBlur', 'imThr'].forEach((id) =>
  $(id).addEventListener(id === 'imThr' || id === 'imSmooth' || id === 'imGamma' || id === 'imBlur' ? 'input' : 'change', () => {
    clearTimeout(imBusy); imBusy = setTimeout(() => { if (id === 'imType' && im) { $('imThr').value = Math.min(140, Math.max(6, im.auto)); } imProcess(); }, 120);
  }));
$('imDl').addEventListener('click', () => imGeo && download(new THREE.Mesh(imGeo), imKind === 'lathe' ? 'phoi_tron_xoay_tu_anh.stl' : 'phu_dieu_tu_anh.stl'));
$('imUse').addEventListener('click', () => {
  if (!imGeo || imKind !== 'lathe') return;
  $('unit').value = '1';
  setMode('shell');
  setBase(imGeo, 'Phôi từ ảnh: ' + (im ? im.name : ''));
});

$('pick').addEventListener('click', () => $('file').click());

window.__app = { THREE, scene, camera, controls, renderer };

// Mở app là có sẵn phôi mẫu để thấy khu vực làm việc
setMode('shell');
renderAngles();
$('demoTwist').click();
