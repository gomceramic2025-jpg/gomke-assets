/**
 * Nhập sao kê: đọc tệp → nhận diện cột → chuẩn hóa → xem trước/chỉnh sửa → (người dùng xác nhận) mới ghi vào sổ.
 * Hàm trong tệp này KHÔNG ghi cơ sở dữ liệu; việc ghi nằm ở commitImport (qua repo, trong một giao dịch DB).
 */
import Papa from 'papaparse';
import { parseDateLoose } from '../domain/dates';
import { parseVndAmount } from '../domain/money';
import { findDuplicates, normalizeText, type DuplicateMatch } from '../domain/duplicates';
import type { Category, Transaction } from '../domain/schemas';
import { sha256Hex } from '../crypto/crypto';
import { importTransactions } from '../db/repo';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20000;

export class ImportError extends Error {
  constructor(message: string, readonly code: 'empty' | 'too-large' | 'format' | 'encoding' | 'scanned' | 'unreadable' | 'too-many-rows' | 'unsupported') {
    super(message); this.name = 'ImportError';
  }
}

export type Cell = string | number | Date | null;
export interface ParsedTable { kind: 'csv' | 'excel' | 'pdf'; fileName: string; fileHash: string; rows: Cell[][]; warnings: string[]; pdfAdapter?: string }

export interface FileInput { name: string; bytes: Uint8Array<ArrayBuffer> }

// ---------- 1. Kiểm tra tệp ----------
export function detectKind(f: FileInput): 'csv' | 'excel' | 'pdf' {
  if (f.bytes.length === 0) throw new ImportError('Tệp rỗng', 'empty');
  if (f.bytes.length > MAX_IMPORT_BYTES) throw new ImportError(`Tệp quá lớn (tối đa ${MAX_IMPORT_BYTES / 1024 / 1024} MB)`, 'too-large');
  const ext = f.name.toLowerCase().split('.').pop() ?? '';
  const b = f.bytes;
  const isZip = b[0] === 0x50 && b[1] === 0x4b;
  const isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
  const isOle = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  if (ext === 'xls' || isOle) throw new ImportError('Định dạng Excel cũ (.xls) chưa hỗ trợ. Hãy mở bằng Excel rồi "Lưu thành" .xlsx hoặc .csv.', 'unsupported');
  if (ext === 'xlsx') { if (!isZip) throw new ImportError('Tệp có đuôi .xlsx nhưng nội dung không phải Excel hợp lệ', 'format'); return 'excel'; }
  if (ext === 'pdf') { if (!isPdf) throw new ImportError('Tệp có đuôi .pdf nhưng nội dung không phải PDF hợp lệ', 'format'); return 'pdf'; }
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    if (isZip || isPdf || b.subarray(0, 4096).includes(0)) throw new ImportError('Tệp có đuôi văn bản nhưng nội dung là dạng nhị phân', 'format');
    return 'csv';
  }
  throw new ImportError(`Không hỗ trợ định dạng ".${ext}". Chỉ nhận .csv, .xlsx, .pdf`, 'format');
}

// ---------- 2. Đọc dữ liệu ----------
export function decodeText(bytes: Uint8Array<ArrayBuffer>): { text: string; warning?: string } {
  let b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3) as Uint8Array<ArrayBuffer>;
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b) }; } catch { /* thử bảng mã khác */ }
  for (const enc of ['windows-1258', 'windows-1252']) {
    try {
      const text = new TextDecoder(enc).decode(b);
      return { text, warning: `Tệp không phải UTF-8; đã đọc bằng bảng mã ${enc}. Hãy kiểm tra tiếng Việt có đúng không.` };
    } catch { /* tiếp */ }
  }
  throw new ImportError('Không đọc được bảng mã của tệp. Hãy lưu lại dạng CSV UTF-8.', 'encoding');
}

export function parseCsv(f: FileInput): ParsedTable {
  const { text, warning } = decodeText(f.bytes);
  const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
  const rows = res.data.map((r) => r.map((c) => (c ?? '').toString().trim() as Cell));
  if (!rows.length) throw new ImportError('Tệp không có dòng dữ liệu nào', 'empty');
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportError(`Quá nhiều dòng (tối đa ${MAX_IMPORT_ROWS})`, 'too-many-rows');
  const warnings = warning ? [warning] : [];
  if (res.errors.length) warnings.push(`${res.errors.length} dòng CSV có cấu trúc bất thường (đã đọc phần có thể).`);
  return { kind: 'csv', fileName: f.name, fileHash: '', rows, warnings };
}

export async function parseExcel(f: FileInput): Promise<ParsedTable> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(f.bytes.buffer as ArrayBuffer); } catch { throw new ImportError('Không mở được tệp Excel (có thể bị hỏng hoặc có mật khẩu)', 'unreadable'); }
  const warnings: string[] = [];
  const sheet = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!sheet) throw new ImportError('Tệp Excel không có dữ liệu', 'empty');
  if (wb.worksheets.filter((s) => s.actualRowCount > 0).length > 1) warnings.push(`Tệp có nhiều trang tính; đang đọc trang "${sheet.name}".`);
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const out: Cell[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v === null || v === undefined) out.push(null);
      else if (v instanceof Date || typeof v === 'number' || typeof v === 'string') out.push(typeof v === 'string' ? v.trim() : v);
      else if (typeof v === 'object' && 'result' in (v as object)) { const r = (v as { result?: unknown }).result; out.push(r instanceof Date || typeof r === 'number' || typeof r === 'string' ? r : null); }
      else if (typeof v === 'object' && 'richText' in (v as object)) out.push((v as { richText: Array<{ text: string }> }).richText.map((t) => t.text).join('').trim());
      else if (typeof v === 'object' && 'text' in (v as object)) out.push(String((v as { text: unknown }).text));
      else out.push(String(v));
    }
    rows.push(out);
  });
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportError(`Quá nhiều dòng (tối đa ${MAX_IMPORT_ROWS})`, 'too-many-rows');
  return { kind: 'excel', fileName: f.name, fileHash: '', rows, warnings };
}

// ---- PDF ----
export interface PdfAdapter {
  id: string; name: string;
  /** Tên ngân hàng/định dạng cụ thể thì kiểm tra nội dung ở đây; adapter chung luôn trả true. */
  detect(fullText: string): boolean;
  parse(lines: string[]): Cell[][];
}

const DATE_RE = '(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4})';
const NUM_RE = '([+-]?\\(?\\d[\\d.,]*\\)?)';
/**
 * Adapter chung (heuristic): dòng bắt đầu bằng ngày, kết thúc bằng 1–2 số (số tiền, [số dư]).
 * KHÔNG đảm bảo đúng với mọi ngân hàng. Luôn cho người dùng xem trước và sửa. Thêm adapter riêng bằng cách đẩy vào PDF_ADAPTERS.
 */
export const genericPdfAdapter: PdfAdapter = {
  id: 'generic', name: 'Định dạng chung (heuristic)',
  detect: () => true,
  parse(lines) {
    const out: Cell[][] = [['Ngày', 'Nội dung', 'Số tiền', 'Số dư']];
    const re2 = new RegExp(`^${DATE_RE}\\s+(.*?)\\s+${NUM_RE}\\s+${NUM_RE}$`);
    const re1 = new RegExp(`^${DATE_RE}\\s+(.*?)\\s+${NUM_RE}$`);
    for (const line of lines) {
      const l = line.replace(/\s+/g, ' ').trim();
      const money = (x: string) => parseVndAmount(x).ok && /[.,]|^[+-]?\d{4,}$/.test(x);
      const m2 = re2.exec(l);
      if (m2 && money(m2[3]!) && money(m2[4]!)) { out.push([m2[1]!, m2[2]!, m2[3]!, m2[4]!]); continue; }
      const m1 = re1.exec(l);
      if (m1 && money(m1[3]!)) out.push([m1[1]!, m1[2]!, m1[3]!, null]);
    }
    return out;
  },
};
export const PDF_ADAPTERS: PdfAdapter[] = [genericPdfAdapter];

async function loadPdfJs() {
  if (import.meta.env.MODE === 'test') return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as typeof import('pdfjs-dist');
  const lib = await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return lib;
}

export async function extractPdfLines(bytes: Uint8Array<ArrayBuffer>): Promise<{ lines: string[]; pages: number; chars: number }> {
  const pdfjs = await loadPdfJs();
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise; }
  catch (e) {
    if (e && typeof e === 'object' && 'name' in e && (e as { name: string }).name === 'PasswordException') throw new ImportError('PDF có mật khẩu — hãy gỡ mật khẩu rồi nhập lại', 'unreadable');
    throw new ImportError('Không đọc được tệp PDF (có thể bị hỏng)', 'unreadable');
  }
  const lines: string[] = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const byY = new Map<number, Array<{ x: number; s: string }>>();
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]! / 3);
      const arr = byY.get(y) ?? [];
      arr.push({ x: it.transform[4]!, s: it.str });
      byY.set(y, arr);
      chars += it.str.length;
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) lines.push(byY.get(y)!.sort((a, b) => a.x - b.x).map((i) => i.s).join(' '));
  }
  return { lines, pages: doc.numPages, chars };
}

export async function parsePdf(f: FileInput): Promise<ParsedTable> {
  const { lines, pages, chars } = await extractPdfLines(f.bytes);
  if (chars < 20 * pages) {
    throw new ImportError('PDF này có vẻ là bản quét (ảnh), không có lớp văn bản. Cần OCR — chưa hỗ trợ trong phiên bản này và độ tin cậy OCR thường thấp hơn. Hãy tải sao kê dạng Excel/CSV từ ngân hàng, hoặc nhập tay.', 'scanned');
  }
  const full = lines.join('\n');
  const adapter = PDF_ADAPTERS.find((a) => a.detect(full)) ?? genericPdfAdapter;
  const rows = adapter.parse(lines);
  const warnings = [`PDF đọc bằng "${adapter.name}". Đây là suy đoán từ văn bản — hãy kiểm tra kỹ từng dòng; số tiền không có dấu +/− cần bạn chọn thu hay chi.`];
  if (rows.length <= 1) throw new ImportError('Đọc được văn bản PDF nhưng không nhận ra dòng giao dịch nào (định dạng chưa được hỗ trợ). Hãy dùng Excel/CSV hoặc nhập tay.', 'unreadable');
  return { kind: 'pdf', fileName: f.name, fileHash: '', rows, warnings, pdfAdapter: adapter.id };
}

export async function readFile(f: FileInput): Promise<ParsedTable> {
  const kind = detectKind(f);
  const hash = await sha256Hex(f.bytes);
  const t = kind === 'csv' ? parseCsv(f) : kind === 'excel' ? await parseExcel(f) : await parsePdf(f);
  t.fileHash = hash;
  return t;
}

// ---------- 3. Nhận diện cột ----------
export type Role = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance' | 'ref';
export interface ColumnMapping {
  headerRow: number; // -1 = không có tiêu đề
  date: number | null; description: number | null; amount: number | null; debit: number | null; credit: number | null; balance: number | null; ref: number | null;
  /** Với cột số tiền có dấu: đảo quy ước (dương = chi) */
  invertSign: boolean;
  /** Với 2 cột nợ/có: đảo (mặc định Ghi nợ = tiền ra, Ghi có = tiền vào) */
  swapDebitCredit: boolean;
  /** Số tiền không có dấu và không có cột nợ/có: mặc định coi là */
  unsignedAs: 'expense' | 'income';
}

const HEADER_WORDS: Record<Role, string[]> = {
  date: ['ngay', 'ngay giao dich', 'ngay gd', 'ngay hach toan', 'date', 'transaction date', 'posting date', 'ngay hieu luc'],
  description: ['noi dung', 'dien giai', 'mo ta', 'noi dung giao dich', 'chi tiet', 'description', 'details', 'narrative', 'ghi chu'],
  amount: ['so tien', 'so tien gd', 'so tien giao dich', 'gia tri', 'amount', 'so tien +/-'],
  debit: ['ghi no', 'no', 'debit', 'so tien ghi no', 'rut ra', 'tien ra', 'chi ra', 'withdrawal'],
  credit: ['ghi co', 'co', 'credit', 'so tien ghi co', 'gui vao', 'tien vao', 'thu vao', 'deposit'],
  balance: ['so du', 'so du cuoi', 'balance', 'so du sau gd', 'so du tai khoan'],
  ref: ['ma gd', 'ma giao dich', 'so tham chieu', 'so ref', 'reference', 'ref', 'so but toan', 'ma tham chieu', 'transaction id', 'so chung tu'],
};

const norm = (c: Cell): string => normalizeText(c === null ? '' : c instanceof Date ? '' : String(c));

export function detectMapping(rows: readonly Cell[][]): { mapping: ColumnMapping; confident: boolean } {
  const empty: ColumnMapping = { headerRow: -1, date: null, description: null, amount: null, debit: null, credit: null, balance: null, ref: null, invertSign: false, swapDebitCredit: false, unsignedAs: 'expense' };
  let best: { row: number; map: Partial<Record<Role, number>>; hits: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const map: Partial<Record<Role, number>> = {};
    (rows[i] ?? []).forEach((cell, col) => {
      const t = norm(cell);
      if (!t) return;
      for (const role of Object.keys(HEADER_WORDS) as Role[]) {
        if (map[role] !== undefined) continue;
        if (HEADER_WORDS[role].includes(t)) { map[role] = col; break; }
      }
    });
    const hits = Object.keys(map).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { row: i, map, hits };
  }
  if (best) {
    const m = best.map;
    const mapping: ColumnMapping = { ...empty, headerRow: best.row, date: m.date ?? null, description: m.description ?? null, amount: m.amount ?? null, debit: m.debit ?? null, credit: m.credit ?? null, balance: m.balance ?? null, ref: m.ref ?? null };
    const confident = mapping.date !== null && (mapping.amount !== null || mapping.debit !== null || mapping.credit !== null);
    return { mapping, confident };
  }
  // Không có tiêu đề: đoán theo nội dung (cột nhiều ngày nhất, cột nhiều số nhất)
  const sample = rows.slice(0, 50);
  const width = Math.max(0, ...sample.map((r) => r.length));
  let dateCol = -1, dateBest = 0;
  const numScore: number[] = [];
  for (let c = 0; c < width; c++) {
    const vals = sample.map((r) => r[c]).filter((v) => v !== null && v !== undefined && v !== '');
    const d = vals.filter((v) => parseDateLoose(v) !== null).length;
    if (d > dateBest && d >= Math.max(2, vals.length * 0.6)) { dateBest = d; dateCol = c; }
    numScore[c] = vals.filter((v) => parseVndAmount(v).ok && parseDateLoose(v) === null).length;
  }
  const mapping: ColumnMapping = { ...empty };
  if (dateCol >= 0) {
    mapping.date = dateCol;
    const cand = numScore.map((s, c) => ({ s, c })).filter((x) => x.c !== dateCol && x.s >= 2).sort((a, b) => b.s - a.s);
    if (cand[0]) mapping.amount = cand[0].c;
    const textCol = Array.from({ length: width }, (_, c) => c).filter((c) => c !== dateCol && c !== mapping.amount).map((c) => ({ c, len: sample.reduce((s, r) => s + String(r[c] ?? '').length, 0) })).sort((a, b) => b.len - a.len)[0];
    if (textCol && textCol.len > 0) mapping.description = textCol.c;
  }
  return { mapping, confident: false };
}

// ---------- 4. Chuẩn hóa + xem trước ----------
export interface ImportRow {
  index: number; // số dòng trong tệp (1-based)
  include: boolean;
  date: string | null;
  amount: number | null; // luôn dương
  type: 'income' | 'expense';
  description: string;
  bankRef: string;
  balance: number | null;
  categoryId: string | null;
  categoryReason: string;
  errors: string[]; warnings: string[];
  duplicates: DuplicateMatch[];
}
export interface NormalizeResult { rows: ImportRow[]; skipped: Array<{ index: number; reason: string }>; }

const SUMMARY_WORDS = ['tong cong', 'tong so', 'so du dau', 'so du cuoi', 'so du dau ky', 'so du cuoi ky', 'total', 'opening balance', 'closing balance', 'cong phat sinh', 'tong phat sinh'];

export function normalizeRows(table: ParsedTable | { rows: readonly Cell[][] }, map: ColumnMapping, ctx: {
  accountId: string; existing: readonly Pick<Transaction, 'id' | 'date' | 'amount' | 'type' | 'accountId' | 'description' | 'bankRef' | 'deletedAt' | 'purged' | 'categoryId'>[]; categories: readonly Category[];
}): NormalizeResult {
  const out: ImportRow[] = [];
  const skipped: NormalizeResult['skipped'] = [];
  const seenRefs = new Set<string>();
  const start = map.headerRow + 1;
  const hasSplit = map.debit !== null || map.credit !== null;
  // Cột số tiền "có dấu" nếu ở đâu đó trong cột có số âm → số dương không dấu là tiền vào
  const signedColumn = !hasSplit && map.amount !== null && table.rows.slice(start).some((r) => {
    const v = r[map.amount!];
    return typeof v === 'number' ? v < 0 : typeof v === 'string' && /^\s*[-−(]|-\s*$/.test(v);
  });
  for (let i = start; i < table.rows.length; i++) {
    const r = table.rows[i]!;
    const idx = i + 1;
    const cell = (c: number | null) => (c === null ? null : r[c] ?? null);
    const rowText = norm(r.map((c) => (c instanceof Date ? '' : String(c ?? ''))).join(' '));
    if (r.every((c) => c === null || c === '')) continue;
    if (SUMMARY_WORDS.some((w) => rowText.startsWith(w) || (rowText.includes(` ${w}`) && parseDateLoose(cell(map.date)) === null))) { skipped.push({ index: idx, reason: 'Dòng tổng kết/số dư' }); continue; }
    const date = parseDateLoose(cell(map.date));
    const errors: string[] = []; const warnings: string[] = [];
    let amount: number | null = null; let type: 'income' | 'expense' = map.unsignedAs;
    const parse = (c: Cell) => (c === null || c === '' ? null : parseVndAmount(c));
    if (hasSplit) {
      const d = parse(cell(map.debit)), c = parse(cell(map.credit));
      const dv = d?.ok ? Math.abs(d.value) : 0, cv = c?.ok ? Math.abs(c.value) : 0;
      if ((d && !d.ok) || (c && !c.ok)) errors.push((d && !d.ok ? d.error : (c as { error: string }).error));
      else if (dv && cv) errors.push('Dòng có cả ghi nợ và ghi có');
      else if (!dv && !cv) { if (date === null) { skipped.push({ index: idx, reason: 'Không phải giao dịch' }); continue; } errors.push('Không có số tiền'); }
      else {
        amount = dv || cv;
        const debitIsExpense = !map.swapDebitCredit;
        type = (dv ? debitIsExpense : !debitIsExpense) ? 'expense' : 'income';
      }
    } else {
      const raw = cell(map.amount);
      const p = parse(raw);
      if (!p) { if (date === null) { skipped.push({ index: idx, reason: 'Không phải giao dịch' }); continue; } errors.push('Thiếu số tiền'); }
      else if (!p.ok) { if (date === null) { skipped.push({ index: idx, reason: 'Không phải giao dịch' }); continue; } errors.push(p.error); }
      else if (p.value === 0) errors.push('Số tiền bằng 0');
      else {
        amount = Math.abs(p.value);
        const hasSign = typeof raw === 'number' ? raw < 0 : /^\s*[-−(]|-\s*$/.test(String(raw)) || /^\s*\+/.test(String(raw));
        if (p.value < 0) type = map.invertSign ? 'income' : 'expense';
        else if (hasSign || signedColumn || typeof raw === 'number') type = map.invertSign ? 'expense' : 'income';
        else { type = map.unsignedAs; warnings.push('Số tiền không có dấu — đã tạm coi là ' + (type === 'expense' ? 'chi' : 'thu') + ', hãy kiểm tra'); }
        if (table && 'kind' in table && table.kind === 'pdf' && p.value > 0 && !/^\s*\+/.test(String(raw))) { type = map.unsignedAs; if (!warnings.length) warnings.push('PDF không cho biết thu/chi — đã tạm coi là ' + (type === 'expense' ? 'chi' : 'thu')); }
      }
    }
    if (date === null) {
      if (errors.length === 0 && amount === null) { skipped.push({ index: idx, reason: 'Không phải giao dịch' }); continue; }
      errors.push('Ngày không hợp lệ');
    }
    const description = String(cell(map.description) ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const bankRef = String(cell(map.ref) ?? '').trim().slice(0, 80);
    const balP = parse(cell(map.balance));
    const row: ImportRow = {
      index: idx, include: errors.length === 0, date, amount, type, description, bankRef, balance: balP?.ok ? balP.value : null,
      categoryId: null, categoryReason: '', errors, warnings, duplicates: [],
    };
    if (bankRef) { if (seenRefs.has(bankRef)) { row.warnings.push(`Mã giao dịch ${bankRef} xuất hiện nhiều lần trong tệp`); } seenRefs.add(bankRef); }
    if (row.date && row.amount) {
      row.duplicates = findDuplicates({ date: row.date, amount: row.amount, type: row.type, accountId: ctx.accountId, description: row.description, bankRef }, ctx.existing);
      if (row.duplicates.length) { row.include = false; row.warnings.push('Nghi trùng với giao dịch đã có — tích chọn nếu vẫn muốn nhập'); }
      const s = suggestCategory(row.description, row.type, ctx.categories, ctx.existing);
      row.categoryId = s.categoryId; row.categoryReason = s.reason;
    }
    out.push(row);
  }
  return { rows: out, skipped };
}

// ---------- 5. Gợi ý danh mục (quy tắc cục bộ + học từ lịch sử, không dùng AI) ----------
const KEYWORDS: Array<{ key: string; words: string[]; kind: 'income' | 'expense' }> = [
  { key: 'income-gomke', words: ['gom ke', 'gomke'], kind: 'income' },
  { key: 'income-interest', words: ['lai tien gui', 'lai suat', 'tra lai', 'lai tk'], kind: 'income' },
  { key: 'living', words: ['grab', 'be ', 'xang', 'cafe', 'coffee', 'ca phe', 'an uong', 'quan an', 'com ', 'pho ', 'bun ', 'highlands', 'circle k', 'winmart', 'coopmart', 'bach hoa', 'dien luc', 'tien dien', 'tien nuoc', 'internet', 'viettel', 'vnpt', 'fpt', 'shopee food', 'grabfood'], kind: 'expense' },
  { key: 'health', words: ['nha thuoc', 'benh vien', 'phong kham', 'kham benh', 'thuoc', 'long chau', 'pharmacity'], kind: 'expense' },
  { key: 'learning', words: ['khoa hoc', 'udemy', 'coursera', 'sach ', 'hoc phi', 'fahasa', 'hoc '], kind: 'expense' },
  { key: 'family', words: ['gui me', 'gui ba', 'ba me', 'cho me', 'cho ba', 'bieu ba me', 'gia dinh'], kind: 'expense' },
  { key: 'expense-gomke', words: ['nguyen lieu', 'men gom', 'dat set', 'lo nung', 'khuon'], kind: 'expense' },
];

export function suggestCategory(description: string, type: 'income' | 'expense', categories: readonly Category[], history: readonly Pick<Transaction, 'description' | 'type' | 'categoryId' | 'deletedAt' | 'purged'>[]): { categoryId: string | null; reason: string } {
  const d = ' ' + normalizeText(description) + ' ';
  if (d.trim()) {
    // 1) Học từ lịch sử của chính bạn: các giao dịch trước có cùng từ khóa đặc trưng
    const tokens = new Set(d.split(' ').filter((t) => t.length >= 4));
    const votes = new Map<string, number>();
    let total = 0;
    for (const h of history) {
      if (h.deletedAt || h.purged || h.type !== type || !h.categoryId) continue;
      const ht = new Set(normalizeText(h.description).split(' '));
      const shared = [...tokens].filter((t) => ht.has(t)).length;
      if (shared >= 1) { votes.set(h.categoryId, (votes.get(h.categoryId) ?? 0) + shared); total += shared; }
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / total >= 0.6 && categories.some((c) => c.id === top[0] && !c.deletedAt)) return { categoryId: top[0], reason: 'Giống các giao dịch trước của bạn' };
  }
  for (const k of KEYWORDS) {
    if (k.kind !== type) continue;
    if (k.words.some((w) => d.includes(' ' + w.trim() + ' ') || d.includes(w))) {
      const c = categories.find((x) => x.systemKey === k.key && !x.deletedAt);
      if (c) return { categoryId: c.id, reason: 'Khớp từ khóa' };
    }
  }
  return { categoryId: null, reason: '' };
}

// ---------- 6. Ghi vào sổ (chỉ sau khi người dùng xác nhận) ----------
export async function commitImport(args: { rows: ImportRow[]; table: Pick<ParsedTable, 'kind' | 'fileName' | 'fileHash' | 'warnings'>; accountId: string; skippedCount: number; categories: readonly Category[]; beforeCommit?: () => void }) {
  const fallback = (t: 'income' | 'expense') => args.categories.find((c) => c.systemKey === (t === 'income' ? 'income-other' : 'other') && !c.deletedAt)?.id ?? null;
  const chosen = args.rows.filter((r) => r.include);
  const bad = chosen.find((r) => r.errors.length || !r.date || !r.amount);
  if (bad) throw new ImportError(`Dòng ${bad.index} còn lỗi — hãy sửa hoặc bỏ chọn trước khi nhập`, 'format');
  if (!chosen.length) throw new ImportError('Chưa chọn dòng nào để nhập', 'empty');
  const txInputs = chosen.map((r) => ({
    type: r.type, amount: r.amount!, date: r.date!, accountId: args.accountId, categoryId: r.categoryId ?? fallback(r.type),
    description: r.description, bankRef: r.bankRef, source: args.table.kind, tags: [] as string[],
  }));
  const log = [
    `Nhập ${chosen.length}/${args.rows.length} dòng; bỏ qua ${args.skippedCount} dòng không phải giao dịch.`,
    ...args.table.warnings.slice(0, 5),
    ...(args.rows.some((r) => r.duplicates.length) ? [`${args.rows.filter((r) => r.duplicates.length).length} dòng nghi trùng; ${chosen.filter((r) => r.duplicates.length).length} dòng vẫn được nhập theo quyết định của bạn.`] : []),
  ];
  return importTransactions({ fileName: args.table.fileName.slice(0, 200), kind: args.table.kind, rowCount: chosen.length, skippedCount: args.skippedCount, accountId: args.accountId, fileHash: args.table.fileHash, note: '', log }, txInputs, { beforeCommit: args.beforeCommit });
}
