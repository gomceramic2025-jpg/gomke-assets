// Phôi mẫu tạo bằng code: bình xoắn 6 cánh, cao 180 mm.
import * as THREE from 'three';
import { cleanGeometry } from './mold.js';

export function twistedVase() {
  const prof = [[0, 38], [10, 44], [30, 50], [60, 48], [95, 36], [130, 24], [155, 20], [170, 22], [180, 24]]; // [y, r]
  const NT = 120, NY = 60, FL = 6, TW = 1.6;
  const rAt = (y) => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, r0] = prof[i], [y1, r1] = prof[i + 1];
      if (y <= y1) { const t = (y - y0) / (y1 - y0); return r0 + (r1 - r0) * t * t * (3 - 2 * t); }
    }
    return prof.at(-1)[1];
  };
  const pos = [], idx = [];
  for (let j = 0; j <= NY; j++) {
    const y = (180 * j) / NY;
    const amp = 0.07 * Math.sin(Math.PI * Math.min(1, y / 20)) * Math.min(1, (180 - y) / 25);
    for (let i = 0; i < NT; i++) {
      const th = (2 * Math.PI * i) / NT;
      const r = rAt(y) * (1 + amp * Math.sin(FL * th + TW * (y / 180) * Math.PI));
      pos.push(r * Math.cos(th), y, r * Math.sin(th));
    }
  }
  const bot = pos.length / 3; pos.push(0, 0, 0);
  const top = bot + 1; pos.push(0, 180, 0);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NT; i++) {
    const a = j * NT + i, b = j * NT + ((i + 1) % NT), c = (j + 1) * NT + i, d = (j + 1) * NT + ((i + 1) % NT);
    idx.push(a, c, b, b, c, d);
  }
  for (let i = 0; i < NT; i++) {
    idx.push(bot, i, (i + 1) % NT);
    const o = NY * NT; idx.push(top, o + ((i + 1) % NT), o + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return cleanGeometry(g);
}
