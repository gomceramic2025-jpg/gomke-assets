import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import {
  cleanGeometry, orientPhoi, phoiStats, countOpenEdges, prepareFaces,
  analyzeDraft, bestTheta, buildMold, buildCasing, plasterCalc,
} from './mold.js';

const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value) || 0;
const fmt = (v, d = 0) => v.toLocaleString('vi-VN', { maximumFractionDigits: d, minimumFractionDigits: d });

// ---------- Cảnh 3D ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4efe8);
const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
camera.position.set(300, 250, 380);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x998877, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(200, 400, 250);
scene.add(sun);
const grid = new THREE.GridHelper(600, 30, 0xb9a995, 0xdccfbf);
scene.add(grid);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

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
  }
  updateDraft();
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
  if (phoiMesh) phoiMesh.visible = $('showPhoi').checked;
  moldGroup.visible = $('showMold').checked;
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
function download(mesh, name) {
  const dv = new STLExporter().parse(mesh, { binary: true });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([dv], { type: 'model/stl' }));
  a.download = name;
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

window.__app = { THREE, scene, camera, controls, renderer };
