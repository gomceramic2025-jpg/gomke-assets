import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import {
  cleanGeometry, orientPhoi, phoiStats, countOpenEdges, prepareFaces,
  analyzeDraft, bestTheta, plasterCalc,
  analyzeDraftAngles,
} from './mold.js';
import { twistedVase } from './sample.js';
import { invertPhoi } from './shell.js';
import { handlers, pack, unpack } from './tasks.js';

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
const sceneBg = () => (matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.getAttribute('data-theme') !== 'light') || document.documentElement.getAttribute('data-theme') === 'dark' ? 0x241e18 : 0xf4efe8;
scene.background = new THREE.Color(sceneBg());
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { scene.background = new THREE.Color(sceneBg()); }); } catch (e) { /* không bắt buộc */ }
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
(function loop() { controls.update(); grid.visible = camera.position.y > -1; if (renderer) renderer.render(scene, camera); requestAnimationFrame(loop); })();

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

// ---------- Việc tính toán nặng: chạy trong Web Worker để trang không bị đứng ----------
let worker = null, workerBroken = false, taskSeq = 0, active = null;
const BUSY_BTNS = ['build', 'shBuild', 'shAuto', 'rmBuild'];

function showBusy(on, text) {
  const el = $('busy');
  if (el) { el.hidden = !on; if (on) $('busyText').textContent = text || 'Đang xử lý...'; }
  BUSY_BTNS.forEach((id) => { const b = $(id); if (b) b.disabled = on || (id === 'shBuild' && shBlocked); });
}
const setBusyText = (t) => { const e = $('busyText'); if (e) e.textContent = t; };

function finishTask(id, ok, val) {
  if (!active || active.id !== id) return; // việc đã bị hủy hoặc thay thế
  const a = active; active = null;
  showBusy(false);
  if (ok) a.resolve(val); else a.reject(val instanceof Error ? val : new Error(String(val)));
}

function getWorker() {
  if (worker) return worker;
  if (workerBroken || typeof Worker === 'undefined' || typeof __WORKER_SRC__ === 'undefined') return null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'text/javascript' })));
    worker.onmessage = (ev) => {
      const m = ev.data;
      if (!active || m.id !== active.id) return;
      if (m.kind === 'progress') setBusyText(m.text);
      else if (m.kind === 'done') finishTask(m.id, true, m.result);
      else finishTask(m.id, false, new Error(m.message));
    };
    worker.onerror = () => {
      // Worker không chạy được (bị chặn hoặc lỗi nạp): chuyển sang chạy trực tiếp
      workerBroken = true; try { worker.terminate(); } catch (e) { /* bỏ qua */ }
      worker = null;
      if (active) { const a = active; setTimeout(() => runDirect(a), 30); }
    };
    return worker;
  } catch (e) { workerBroken = true; return null; }
}

function runDirect(a) {
  Promise.resolve().then(() => handlers[a.type](a.payload, setBusyText))
    .then(({ result }) => finishTask(a.id, true, result), (e) => finishTask(a.id, false, e));
}

// Việc mới luôn thay thế việc cũ đang chạy (ví dụ đổi phôi giữa lúc đang tạo hộp bao)
function cancelActive() {
  if (!active) return;
  const a = active; active = null;
  if (worker) { worker.terminate(); worker = null; }
  showBusy(false);
  const err = new Error('cancelled'); err.cancelled = true;
  a.reject(err);
}

function runTask(type, payload, text, transfer) {
  cancelActive();
  const id = ++taskSeq;
  return new Promise((resolve, reject) => {
    const a = { id, type, payload, resolve, reject };
    active = a;
    showBusy(true, text);
    const w = getWorker();
    if (w) w.postMessage({ id, type, payload }, transfer || []);
    else setTimeout(() => runDirect(a), 30); // chừa thời gian cho trình duyệt vẽ thanh tiến trình
  });
}
const isCancelled = (e) => e && e.cancelled;
$('busyCancel').addEventListener('click', () => { cancelActive(); toast('Đã hủy.'); });
let shBlocked = false;
let phoiVer = 0;                        // tăng mỗi khi phôi thay đổi
const modeVer = { shell: -1, box: -1 }; // phiên bản phôi mà từng tab đã xử lý

const status = (t, err) => { $('status').textContent = t; $('status').className = err ? 'err' : ''; };
let toastTimer = null;
// Thông báo nổi ở cuối màn hình: luôn thấy được dù đang ở tab nào hay cuộn tới đâu
function toast(t, err) {
  const el = $('toast');
  el.textContent = t; el.className = err ? 'err' : ''; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, err ? 10000 : 5000);
}

// ---------- Nạp phôi ----------
let repairNote = '';

// Gắn phôi đã làm sạch vào hệ thống
function commitBase(g, name, rx0 = 0) {
  g.computeBoundingBox();
  const bs = g.boundingBox.getSize(new THREE.Vector3());
  if (![bs.x, bs.y, bs.z].every((v) => isFinite(v) && v > 0)) throw new Error('kích thước mô hình không hợp lệ');
  baseGeo = g;
  rot.x = rx0; rot.z = 0;
  pourManual = false;
  $('fileName').textContent = name;
  rebuildPhoi(true);
  const sz = phoiStats(phoi).size;
  const big = Math.max(...sz);
  if (big > 700 || big < 25) toast('Kích thước phôi ' + fmt(sz[0]) + ' × ' + fmt(sz[2]) + ' × ' + fmt(sz[1]) + ' mm có vẻ bất thường. Kiểm tra “Đơn vị file” (mm, cm, m, inch).', true);
}

// Phôi mẫu (nhỏ, đã kín): làm sạch ngay trên trang
function setBase(geo, name) {
  const g = cleanGeometry(geo);
  repairNote = '';
  commitBase(g, name);
}

// File người dùng: làm sạch và tự vá lưới hở trong worker
async function setBaseFromFile(geo, name, buf3mf) {
  const voxel = parseFloat($('detail').value) || 1.3;
  let payload, transfer;
  if (buf3mf) {
    payload = { buf3mf: new Uint8Array(buf3mf), autoRepair: $('autoRepair').checked, solid: $('autoSolid').checked, voxel };
    transfer = [buf3mf];
  } else {
    const pc = geo.attributes && geo.attributes.position ? geo.attributes.position.count : 0;
    if (pc < 12) throw new Error('file không có mặt tam giác nào (rỗng hoặc sai định dạng)');
    if (pc / 3 > 6000000) throw new Error('mô hình có ' + (pc / 3000000).toFixed(1) + ' triệu mặt, vượt quá khả năng của trình duyệt (tối đa 6 triệu). Hãy giảm mặt bằng phần mềm 3D rồi tải lại');
    const raw = geo.attributes.position.array; // chuyển thẳng sang worker, không sao chép (file nặng rất tốn bộ nhớ)
    payload = { geo: { pos: raw }, autoRepair: $('autoRepair').checked, solid: $('autoSolid').checked, voxel };
    transfer = [raw.buffer];
  }
  const r = await runTask('prepare', payload, 'Đang đọc và làm sạch lưới...', transfer);
  const g = unpack(r.geo);
  const tris = g.index ? g.index.count / 3 : 0;
  if (tris < 4) throw new Error('mô hình không có đủ mặt để dựng khối');
  const i = r.info, k = (n) => fmt(Math.round(n / 1000)) + ' nghìn';
  const notes = [];
  if (buf3mf) {
    $('unit').value = '1'; // 3MF đã được quy đổi sang mm
    notes.push('Đã đọc file 3MF' + (i.objects > 1 ? ` (${i.objects} vật thể, đã gộp làm một)` : '') + '. 3MF để trục Z hướng lên nên app đã tự xoay cho đứng; nếu bị ngược thì dùng nút “Xoay quanh X 90°”.');
  }
  if (i.cap) {
    const where = { '-z': 'đóng đáy phẳng phía dưới (trục Z)', '+z': 'đóng đáy phẳng phía trên (trục Z)', '-y': 'đóng đáy phẳng phía dưới (trục Y)', '+y': 'đóng đáy phẳng phía trên (trục Y)', '-x': 'đóng một đầu theo trục X âm', '+x': 'đóng một đầu theo trục X dương', 'che-chan': 'lấp các khoang và cửa hở' }[i.cap] || 'điền đầy';
    notes.push(`Mô hình là vỏ rỗng hở nên app đã ${where} và điền đầy thành khối đặc. Hãy xem lại hình dạng trước khi tạo khuôn.`);
  }
  if (i.decimated) notes.push(`Mô hình ${k(i.trisBefore)} mặt quá nặng nên đã được giảm xuống còn ${k(i.trisAfter)} mặt.`);
  if (i.repaired && i.openBefore > 0) notes.push(`Đã tự vá lưới hở: ${fmt(i.openBefore)} cạnh hở → ${fmt(i.openAfter)}.`);
  if (i.voxel) notes.push(`Lưới mới có ô khoảng ${fmt(i.voxel, 1)} mm và đã bám sát bề mặt gốc. Chi tiết nhỏ hơn mức này có thể bị mất (chọn “Chi tiết” hoặc “Rất chi tiết” nếu cần giữ nhiều hơn).`);
  repairNote = notes.filter((x) => !x.startsWith('Đã đọc file 3MF')).join(' ');
  g.computeVertexNormals();
  commitBase(g, name, buf3mf ? 270 : 0);
  if (notes.length) toast(notes.join(' '), i.openAfter > 0);
}

function loadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['stl', 'obj', '3mf'].includes(ext)) return toast('Chỉ nhận file .stl, .obj hoặc .3mf. File vừa chọn: ' + file.name, true);
  const fail = (e) => {
    if (isCancelled(e)) return;
    const m = /DataView|bounds|Offset|Invalid|Unexpected/i.test(e.message) ? 'file không đúng định dạng hoặc bị hỏng' : e.message;
    toast('Không đọc được file “' + file.name + '”: ' + m + '. Phôi cũ được giữ nguyên.', true);
  };
  const reader = new FileReader();
  reader.onerror = () => toast('Không mở được file “' + file.name + '”.', true);
  reader.onload = async () => {
    try {
      if (ext === '3mf') return await setBaseFromFile(null, file.name, reader.result);
      let geo;
      if (ext === 'stl') geo = new STLLoader().parse(reader.result);
      else {
        const gs = [];
        new OBJLoader().parse(reader.result).traverse((o) => { if (o.isMesh) gs.push(o.geometry.index ? o.geometry.toNonIndexed() : o.geometry); });
        if (!gs.length) throw new Error('File OBJ không có mặt tam giác');
        geo = mergeGeos(gs);
      }
      await setBaseFromFile(geo, file.name);
    } catch (e) { fail(e); }
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

$('file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadFile(f); });
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
  phoiVer++;
  cancelActive();
  clearMold();
  const unit = num('unit') || 1;
  let shrink = num('shrink');
  if (!(shrink >= 0 && shrink <= 30)) { shrink = Math.min(30, Math.max(0, shrink || 0)); $('shrink').value = shrink; toast('Co ngót chỉ nhận từ 0 đến 30%. Đã đặt lại thành ' + shrink + '%.', true); }
  phoi = orientPhoi(baseGeo, { unit, rx: rot.x, rz: rot.z, shrink: shrink / 100 });
  const st = phoiStats(phoi);
  faces = prepareFaces(phoi);
  const open = countOpenEdges(phoi);
  const fired = orientPhoi(baseGeo, { unit, rx: rot.x, rz: rot.z, shrink: 0 });
  const fs = phoiStats(fired).size;
  $('phoiInfo').innerHTML =
    `Phôi in (đã bù co ngót): <b>${fmt(st.size[0])} × ${fmt(st.size[2])} × ${fmt(st.size[1], 0)} mm</b> (rộng × sâu × cao)<br>` +
    `Sản phẩm sau nung: ${fmt(fs[0])} × ${fmt(fs[2])} × ${fmt(fs[1])} mm<br>` +
    `Thể tích phôi: ${fmt(st.volume / 1000, 1)} cm³ · ${fmt(st.tris)} mặt` +
    (open ? `<br><span class="warn">⚠ Lưới phôi hở/không kín (${open} cạnh). Bật “Tự vá lưới hở” rồi tải lại file, hoặc sửa trong Blender/Meshmixer (Make Manifold).</span>` : '<br><span class="ok">✓ Lưới kín, dùng được.</span>' + (repairNote ? `<br><span class="muted">${repairNote}</span>` : '')) +
    (st.tris > 150000 ? '<br><span class="warn">⚠ Nhiều mặt, tạo khuôn sẽ chậm. Tải lại file để app tự giảm mặt, hoặc chọn độ chi tiết thấp hơn.</span>' : '');
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
  phoiMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: false }));
  scene.add(phoiMesh);
  applyVisibility();
}

function applyVisibility() {
  if (phoiMesh) phoiMesh.visible = !shellMode && $('showPhoi').checked;
  moldGroup.visible = !shellMode && $('showMold').checked;
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
  if (!(o.wall >= 10)) return toast('Thành khuôn nên từ 10 mm trở lên.', true);
  if (!(o.base >= 5 && o.spare >= 5 && o.pourR >= 2)) return toast('Đáy dưới phôi, cao phễu rót và bán kính lỗ rót đang quá nhỏ hoặc để trống.', true);
  clearMold();
  status('Đang tạo khuôn...');
  const t0 = performance.now();
  runTask('mold', { phoi: pack(phoi), o }, 'Đang tạo khuôn...').then((r) => {
    mold = { shape: r.shape, R: r.R, top: r.top, bottom: r.bottom, dims: r.dims, pieces: r.pieces.map((p) => ({ geometry: unpack(p.geo), volume: p.volume, mid: p.mid })) };
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
  }).catch((e) => {
    if (isCancelled(e)) return;
    console.error(e);
    clearMold();
    status('Tạo khuôn lỗi: ' + e.message, true);
    toast('Tạo khuôn lỗi: ' + e.message + '. Nếu lỗi không rõ, thường do lưới phôi không kín hoặc quá nhiều mặt.', true);
  });
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
        runTask('casing', { k: i }, `Đang tạo hộp đổ mảnh ${i + 1}...`).then((c) => {
          const g = unpack(c.geo);
          download(new THREE.Mesh(g), `hop_do_manh${i + 1}.stl`);
          status(`Hộp đổ mảnh ${i + 1}: ${fmt(c.size[0])} × ${fmt(c.size[2])} × ${fmt(c.size[1])} mm, khoảng ${fmt(c.volume / 1000)} cm³ nhựa đặc (slicer sẽ để rỗng bớt). Đặt mặt sàn xuống bàn in, đổ thạch cao tới mép tường.`);
        }).catch((e) => {
          if (isCancelled(e)) return;
          console.error(e); status('Tạo hộp đổ lỗi: ' + e.message, true); toast('Tạo hộp đổ lỗi: ' + e.message, true);
        }).finally(() => { b.disabled = false; });
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
      toast('Đã lưu file .zip. Giải nén ra sẽ có ' + name);
    } catch (e) { if (e.code !== 'declined') toast('Không lưu được file: ' + (e.message || e.code), true); }
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
    try { await dl.save({ filename: zipName, data: blob }); toast(`Đã lưu ${zipName}. Giải nén ra sẽ có ${files.length} file STL.`); }
    catch (e) { if (e.code !== 'declined') toast('Không lưu được file: ' + (e.message || e.code), true); }
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
let imgGeoMesh = null, imgFit = { r: 100, cy: 90 };
const shellGroup = new THREE.Group();
scene.add(shellGroup);
let shellAngles = [0, 120, 240];
let shellFaces = null, shellDraft = null, shellRes = null, invMesh = null, shellTimer = null;
const sh = (id) => num(id);
// Giới hạn hợp lý cho từng thông số hộp bao: [id, nhỏ nhất, lớn nhất, tên]
const SH_LIMITS = [['shWall', 8, 80, 'Độ dày thạch cao'], ['shShell', 0.8, 6, 'Độ dày vỏ in'], ['shDiv', 0.6, 6, 'Độ dày vách chia'], ['shGap', 0, 2, 'Khe hở lắp ráp'],
  ['shSpare', 5, 80, 'Cao cuống rót'], ['shPour', 2, 120, 'Bán kính cuống rót'], ['shBase', 5, 120, 'Lớp thạch cao phủ trên chân phôi'], ['shKey', 0, 10, 'Bán kính chốt'], ['shKeyN', 1, 4, 'Số chốt mỗi mặt chia']];
function shClamp() {
  const fixed = [];
  for (const [id, lo, hi, name] of SH_LIMITS) {
    const raw = parseFloat($(id).value);
    const v = Number.isFinite(raw) ? Math.min(hi, Math.max(lo, raw)) : lo;
    if (v !== raw) { $(id).value = v; fixed.push(`${name} đặt lại thành ${v}`); }
  }
  if (fixed.length) toast('Có giá trị ngoài giới hạn cho phép: ' + fixed.join('; ') + '.', true);
}
const shStatus = (t, err) => { $('shStatus').textContent = t; $('shStatus').style.color = err ? 'var(--err)' : ''; };
const PANEL_COLORS = [0xe3b04b, 0xd9893a, 0x8cc47a, 0xe6c86a, 0xcf7a5a, 0x9bb8d9, 0xd6a0c2, 0xa7c957];
const DRAFT_COLORS = [[0.35, 0.72, 0.4], [0.95, 0.78, 0.2], [0.88, 0.2, 0.18]];

function setMode(m) {
  shellMode = m === 'shell';
  $('modeShell').hidden = !shellMode;
  $('modeBox').hidden = m !== 'box';
  $('tabShell').classList.toggle('on', shellMode);
  $('tabBox').classList.toggle('on', m === 'box');
  shellGroup.visible = shellMode;
  if (phoi && modeVer[shellMode ? 'shell' : 'box'] !== phoiVer) modeRefresh(); // phôi chưa đổi thì giữ nguyên kết quả đã có
  applyVisibility();
}
$('tabShell').addEventListener('click', () => setMode('shell'));
$('tabBox').addEventListener('click', () => setMode('box'));

function modeRefresh() {
  if (!phoi) return;
  modeVer[shellMode ? 'shell' : 'box'] = phoiVer;
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
    inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!Number.isFinite(v)) { toast('Góc phải là một số (độ).', true); inp.value = shellAngles[i]; return; } shellAngles[i] = ((v % 360) + 360) % 360; shellAnglesChanged(); });
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
function shellAnalyze(refit = false) {
  if (!phoi) return;
  const inv = invertPhoi(phoi, Math.max(5, sh('shSpare')));
  shellFaces = prepareFaces(inv);
  shellDraft = analyzeDraftAngles(shellFaces, shellAngles, sh('shMinDraft'));
  const a = shellDraft.area, tot = a[0] + a[1] + a[2] || 1;
  const pc = (i) => fmt((a[i] / tot) * 100, 1) + '%';
  const spans = shellDraft.sectors.map((s) => fmt(s.span)).join('°, ') + '°';
  let msg = `<span class="dot g"></span>Thoát tốt ${pc(0)} &nbsp; <span class="dot y"></span>Ít góc thoát ${pc(1)} &nbsp; <span class="dot r"></span>Undercut ${pc(2)}<br><span class="muted">${shellAngles.length} mảnh, độ rộng: ${spans}</span>`;
  const minSpan = Math.min(...shellDraft.sectors.map((x) => x.span));
  let blocked = false;
  if (minSpan < 3) { blocked = true; msg += '<br><span class="warn">⚠ Hai vách chia trùng góc hoặc quá sát nhau (dưới 3°). Hãy sửa góc hoặc xóa bớt một vách.</span>'; }
  else if (shellDraft.maxSpan > 180.01) msg += '<br><span class="warn">⚠ Có mảnh rộng hơn 180°, không tháo ra được. Thêm vách chia vào khoảng đó.</span>';
  else if (a[2] / tot > 0.002) msg += '<br><span class="warn">⚠ Còn vùng undercut (màu đỏ): mảnh có thể kẹt khi tháo. Thử “Tự phân tích”, thêm vách hoặc dời vách khỏi vùng đỏ.</span>';
  else msg += '<br><span class="ok">✓ Không có undercut theo hướng kéo của các mảnh.</span>';
  const mouthR = phoiMouthRadius();
  if (sh('shPour') > mouthR * 1.05) msg += `<br><span class="warn">⚠ Bán kính cuống rót (${fmt(sh('shPour'), 1)} mm) lớn hơn miệng phôi (khoảng ${fmt(mouthR, 1)} mm). Nên giảm xuống dưới ${fmt(mouthR * 0.9, 1)} mm.</span>`;
  $('shDraft').innerHTML = msg;
  shBlocked = blocked || shellDraft.maxSpan > 180.01;
  $('shBuild').disabled = shBlocked || !!active;
  drawInverted(inv, refit);
}

function phoiMouthRadius() {
  const p = phoi.attributes.position, H = phoiStats(phoi).H;
  let re = 0;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > H * 0.97) re = Math.max(re, Math.hypot(p.getX(i), p.getZ(i)));
  return re || phoiStats(phoi).rmax * 0.4;
}

function drawInverted(inv, refit = false) {
  if (invMesh) { shellGroup.remove(invMesh); invMesh.geometry.dispose(); invMesh = null; }
  if (shellRes) return; // đã có hộp bao: phôi hiển thị trong cụm bung
  invMesh = makePositiveMesh(inv);
  shellGroup.add(invMesh);
  if (refit) fitShell(phoiStats(phoi).rmax + sh('shWall'), (phoiStats(phoi).H + sh('shSpare')) / 2);
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
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: false }));
  m.userData = { kind: 'phoi', mid: 0 };
  return m;
}

function fitShell(r, cy) { fitCamera(r, cy); }

function shellPhoiChanged() {
  clearShell();
  clearTimeout(shellTimer);
  if ($('shAutoOn').checked) {
    shStatus('Đang chờ để phân tích phôi...');
    // đợi một chút: nếu người dùng còn đang đổi đơn vị/co ngót thì chỉ làm một lần ở cuối
    shellTimer = setTimeout(() => {
      shStatus('Đang phân tích phôi...');
      shellAutoRun(true);
    }, 450);
  } else {
    shellAnalyze(true);
    renderAngles();
    shStatus('');
  }
}
function shellAutoRun(refit) {
  const myVer = phoiVer;
  const inv = invertPhoi(phoi, Math.max(5, sh('shSpare')));
  runTask('layout', { phoi: pack(inv), minDraft: sh('shMinDraft') }, 'Đang phân tích số mảnh và góc chia...').then((b) => {
    if (myVer !== phoiVer) return; // phôi đã đổi trong lúc phân tích
    shellAngles = b.angles.map((x) => Math.round(x * 10) / 10);
    renderAngles();
    shellAnalyze(refit);
    shellBuildNow();
  }).catch((e) => { if (!isCancelled(e)) { shStatus('Phân tích lỗi: ' + e.message, true); toast('Phân tích lỗi: ' + e.message, true); } });
}
function shellAnalyze0() { shellFaces = prepareFaces(invertPhoi(phoi, Math.max(5, sh('shSpare')))); }

$('shAuto').addEventListener('click', () => {
  if (!phoi) return toast('Hãy tải phôi trước.', true);
  clearTimeout(shellTimer);
  clearShell();
  shClamp();
  shStatus('Đang phân tích phôi...');
  shellAutoRun(false);
});
$('shBuild').addEventListener('click', () => { clearTimeout(shellTimer); shellBuildNow(); });
$('shShowDraft').addEventListener('change', () => { if (phoi && !shellRes) shellAnalyze(); });
['shWall', 'shShell', 'shDiv', 'shGap', 'shSpare', 'shPour', 'shBase', 'shKey', 'shKeyN', 'shKeyType'].forEach((id) => $(id).addEventListener('change', () => { shClamp(); clearShell(); shellAnalyze(); }));
$('shMinDraft').addEventListener('change', () => { clearShell(); shellAnalyze(); });

function shellBuildNow() {
  if (!phoi) return;
  shClamp();
  if (shellDraft && shellDraft.maxSpan > 180.01) return toast('Có mảnh rộng hơn 180°, hãy thêm vách chia.', true);
  const o = {
    angles: [...shellAngles].sort((a, b) => a - b), wall: sh('shWall'), shell: sh('shShell'), divider: sh('shDiv'), gap: sh('shGap'),
    spare: sh('shSpare'), pourR: sh('shPour'), base: sh('shBase'), keyR: sh('shKey'), clear: sh('shGap'),
    keyCount: Math.round(sh('shKeyN')), keyType: $('shKeyType').value === 'auto' ? (shellAngles.length <= 3 ? 'dome' : 'ball') : $('shKeyType').value,
  };
  const myVer = phoiVer, t0 = performance.now();
  shStatus('Đang tạo hộp bao...');
  runTask('shell', { phoi: pack(phoi), o }, 'Đang tạo hộp bao...').then((r) => {
    if (myVer !== phoiVer) return;
    r.parts.forEach((p) => { p.geometry = unpack(p.geo); });
    showShell(r, o);
    shStatus(`Xong trong ${fmt((performance.now() - t0) / 1000, 1)} giây.`);
  }).catch((e) => {
    if (isCancelled(e)) return;
    console.error(e);
    shStatus('Tạo hộp bao lỗi: ' + e.message, true);
    toast('Tạo hộp bao lỗi: ' + e.message + '. Nếu lỗi không rõ, thường do lưới phôi không kín hoặc quá nhiều mặt.', true);
  });
}

const KIND_COLOR = { divider: 0xd0382c, base: 0x4fb6a0 };
function keyText(k, o) {
  if (!k || k.type === 'none') return (o.keyType === 'none' || !(o.keyR > 0)) ? '<br><span class="muted">Không có chốt định vị.</span>' : '<br><span class="warn">⚠ Thành thạch cao quá mỏng nên không đặt được chốt. Tăng “Độ dày thạch cao” (cần khoảng 14 mm trở lên) hoặc giảm bán kính chốt.</span>';
  const shrink = k.clamped ? ` <span class="warn">(đã thu nhỏ từ ${fmt(o.keyR, 1)} mm cho vừa thành thạch cao)</span>` : '';
  if (k.type === 'dome') return `<br>Chốt <b>lồi – lõm</b>: ${k.count} chốt, bán kính ${fmt(k.r, 1)} mm${shrink}. Mỗi mảnh có chốt lồi khớp vào lỗ của mảnh kề.`;
  return `<br>Chốt <b>lỗ lõm + bi rời</b>: ${k.count} lỗ, cần <b>${k.count} viên bi ⌀ ${fmt(k.ballD, 1)} mm</b> (file “Bi định vị” để in, hoặc dùng bi thép/bi thủy tinh cỡ này)${shrink}.`;
}

function showShell(r, o) {
  while (shellGroup.children.length) { const m = shellGroup.children.pop(); if (m.geometry) m.geometry.dispose(); }
  invMesh = null;
  shellRes = { r, o };
  let pi = 0;
  r.parts.forEach((p) => {
    if (p.kind === 'phoi' || p.kind === 'key') return;
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
    `Hộp bao Ø${fmt(r.dims.D)} × cao ${fmt(r.dims.H)} mm. Chia ${nD} mảnh thạch cao.` + keyText(r.keyInfo, o);
  showShellPlaster();
  $('shDlAll').disabled = false;
  const box = $('shDlParts'); box.innerHTML = '';
  r.parts.forEach((p) => {
    const b = document.createElement('button'); b.textContent = p.label;
    b.addEventListener('click', () => download(new THREE.Mesh(p.geometry), p.name + '.stl'));
    box.appendChild(b);
  });
  $('shGuide').innerHTML = `Cách dùng: in cuống + phôi đảo ngược, đế, vách và vỏ. Đặt phôi lên đế, cắm các vách chia vào sát phôi, ghép vỏ ngoài vào giữa các vách và buộc dây thun. Trét kín mối nối bằng đất sét, rồi đổ thạch cao tới ${fmt(r.yTop)} mm. Chốt định vị tự tạo trên thạch cao: nếu chọn bi rời thì đặt bi vào các lỗ khi ghép khuôn.`;
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


$('pick').addEventListener('click', () => $('file').click());

window.__app = { THREE, scene, camera, controls, renderer };

// Mở app là có sẵn phôi mẫu để thấy khu vực làm việc
setMode('shell');
renderAngles();
$('demoTwist').click();
