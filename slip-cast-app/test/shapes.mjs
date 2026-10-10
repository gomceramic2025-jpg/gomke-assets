import * as THREE from 'three';
import { orientPhoi, prepareFaces, bestLayout, countOpenEdges } from '../src/mold.js';
import { buildShell, invertPhoi } from '../src/shell.js';
import { twistedVase } from '../src/sample.js';
const base = { wall: 25, shell: 2, divider: 1.2, gap: 0.3, spare: 25, pourR: 14, base: 20, keyR: 5, clear: 0.3, keyType: 'ball', keyCount: 2 };
for (const [shape, extra, center] of [['conformal', {}, 'bbox'], ['cylinder', {}, 'circle'], ['cylinder', { ribs: true }, 'circle'], ['box', {}, 'bbox'], ['box', { ribs: true, noPanels: true }, 'bbox']]) {
  const ph = orientPhoi(twistedVase(), { shrink: 0.12, center }); const bl = bestLayout(prepareFaces(invertPhoi(ph, 25)), 1);
  const t = Date.now(); const r = buildShell(ph, { ...base, ...extra, shape, angles: bl.angles });
  const tri = (k) => r.parts.filter((p) => p.kind === k).map((p) => (p.geometry.attributes.position.count / 3) | 0).join(',');
  console.log(shape.padEnd(9), JSON.stringify(extra).padEnd(30), bl.n, 'mảnh', (Date.now() - t) + ' ms | thạch cao', (r.plasterMm3 / 1e6).toFixed(2), 'L | ngoài', r.dims.W.toFixed(0) + '×' + r.dims.P.toFixed(0) + '×' + r.dims.H.toFixed(0), '| vỏ', tri('panel') || '-', '| vách', tri('divider'), '| chốt', JSON.stringify({ r: +r.keyInfo.r.toFixed(1), n: r.keyInfo.count }));
}
