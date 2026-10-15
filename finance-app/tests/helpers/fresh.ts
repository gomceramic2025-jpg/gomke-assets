import { FinanceDB, setDatabase } from '../../src/db/db';
import { ensureDefaults } from '../../src/db/seed';

let n = 0;
export async function freshDb(withDefaults = true): Promise<FinanceDB> {
  const d = new FinanceDB(`t-${++n}-${Math.random().toString(36).slice(2)}`);
  setDatabase(d);
  if (withDefaults) await ensureDefaults();
  return d;
}

/** PDF tối thiểu có lớp văn bản (ASCII) — dùng cho test nhập PDF. */
export function makePdf(lines: string[]): Uint8Array<ArrayBuffer> {
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&');
  const stream = lines.map((l, i) => `BT /F1 10 Tf 40 ${780 - i * 14} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'utf8'));
