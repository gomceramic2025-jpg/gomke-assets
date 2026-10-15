import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import { freshDb, makePdf, utf8 } from './helpers/fresh';
import { db } from '../src/db/db';
import * as repo from '../src/db/repo';
import { commitImport, detectKind, detectMapping, extractPdfLines, ImportError, normalizeRows, readFile, suggestCategory, MAX_IMPORT_BYTES } from '../src/io/importer';

const CSV_VN = `Ngày giao dịch,Diễn giải,Ghi nợ,Ghi có,Số dư,Mã GD
05/03/2026,Thanh toan Highlands Coffee,"45.000",,"1.455.000",FT001
06/03/2026,Nhan tien tu Gom Ke,,"8.000.000","9.455.000",FT002
07/03/2026,Gui me,"1.000.000",,"8.455.000",FT003
,Tổng cộng,"1.045.000","8.000.000",,
`;
const accountId = 'acc-bank';
let categories: Awaited<ReturnType<typeof repo.listLive<'categories'>>>;

beforeEach(async () => { await freshDb(); categories = await repo.listLive('categories'); });

const norm = async (t: { rows: never[][] }, map: ReturnType<typeof detectMapping>['mapping']) =>
  normalizeRows(t, map, { accountId, existing: await db.transactions.toArray(), categories });

describe('kiểm tra tệp', () => {
  it('tệp rỗng, quá lớn, sai định dạng, nhị phân đội lốt', () => {
    expect(() => detectKind({ name: 'a.csv', bytes: new Uint8Array(0) })).toThrow(/rỗng/);
    expect(() => detectKind({ name: 'a.csv', bytes: new Uint8Array(MAX_IMPORT_BYTES + 1) })).toThrow(/quá lớn/);
    expect(() => detectKind({ name: 'a.docx', bytes: utf8('x') })).toThrow(/Không hỗ trợ/);
    expect(() => detectKind({ name: 'a.xls', bytes: utf8('x') })).toThrow(/\.xls/);
    expect(() => detectKind({ name: 'a.xlsx', bytes: utf8('đây là text') })).toThrow(/không phải Excel/);
    expect(() => detectKind({ name: 'a.pdf', bytes: utf8('đây là text') })).toThrow(/không phải PDF/);
    expect(() => detectKind({ name: 'a.csv', bytes: new Uint8Array([0x50, 0x4b, 3, 4]) })).toThrow(/nhị phân/);
    expect(detectKind({ name: 'A.CSV', bytes: utf8('a,b') })).toBe('csv');
  });
});

describe('CSV', () => {
  it('đọc CSV UTF-8 sao kê Việt Nam: cột ghi nợ/ghi có riêng, số 1.000.000, bỏ dòng tổng kết', async () => {
    const t = await readFile({ name: 'sk.csv', bytes: utf8(CSV_VN) });
    expect(t.fileHash).toHaveLength(64);
    const { mapping, confident } = detectMapping(t.rows);
    expect(confident).toBe(true);
    expect(mapping).toMatchObject({ headerRow: 0, date: 0, description: 1, debit: 2, credit: 3, balance: 4, ref: 5 });
    const r = await norm(t as never, mapping);
    expect(r.rows).toHaveLength(3);
    expect(r.skipped).toHaveLength(1);
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([['expense', 45000], ['income', 8_000_000], ['expense', 1_000_000]]);
    expect(r.rows[1]!.categoryId).toBe('cat-inc-gomke');
    expect(r.rows[0]!.date).toBe('2026-03-05');
  });

  it('không mặc định dương = thu nhập khi có cột ghi nợ/ghi có riêng (nợ dương vẫn là chi)', async () => {
    const t = await readFile({ name: 'sk.csv', bytes: utf8(CSV_VN) });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    expect(r.rows[0]!.type).toBe('expense');
  });

  it('cột số tiền có dấu: âm = chi, dương = thu; có thể đảo quy ước', async () => {
    const csv = 'Date,Description,Amount\n2026-03-01,Salary,"5,000,000"\n2026-03-02,Grab,"-85,000"\n';
    const t = await readFile({ name: 'x.csv', bytes: utf8(csv) });
    const m = detectMapping(t.rows).mapping;
    const r = await norm(t as never, m);
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([['income', 5_000_000], ['expense', 85_000]]);
    const inv = await norm(t as never, { ...m, invertSign: true });
    expect(inv.rows.map((x) => x.type)).toEqual(['expense', 'income']);
  });

  it('dấu phân cách chấm phẩy và bảng mã Windows-1258 được xử lý, có cảnh báo', async () => {
    const semi = await readFile({ name: 'x.csv', bytes: utf8('Ngày;Nội dung;Số tiền\n01/03/2026;Cà phê;-30.000\n') });
    expect(semi.rows[1]).toEqual(['01/03/2026', 'Cà phê', '-30.000']);
    const latin = new Uint8Array(Buffer.from('Ngay;Noi dung;So tien\n01/03/2026;Ca ph\xea;-30.000\n', 'latin1'));
    const t = await readFile({ name: 'x.csv', bytes: latin });
    expect(t.warnings.join(' ')).toMatch(/bảng mã/);
  });

  it('dòng lỗi: ngày sai, số tiền sai → báo lỗi, không tự đưa vào sổ', async () => {
    const csv = 'Ngày,Nội dung,Số tiền\n31/02/2026,Sai ngày,"-1.000"\n05/03/2026,Sai tiền,abc\n06/03/2026,Số lẻ,"-1,5"\n07/03/2026,Đúng,"-2.000"\n';
    const t = await readFile({ name: 'x.csv', bytes: utf8(csv) });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    expect(r.rows).toHaveLength(4);
    expect(r.rows.map((x) => x.errors.length > 0)).toEqual([true, true, true, false]);
    expect(r.rows.filter((x) => x.include)).toHaveLength(1);
  });

  it('không nhầm 1.000.000 thành 1.000', async () => {
    const t = await readFile({ name: 'x.csv', bytes: utf8('Ngày,Nội dung,Số tiền\n01/03/2026,a,"-1.000.000"\n02/03/2026,b,"-1.000"\n') });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    expect(r.rows.map((x) => x.amount)).toEqual([1_000_000, 1_000]);
  });

  it('CSV chỉ có tiêu đề hoặc rỗng', async () => {
    await expect(readFile({ name: 'x.csv', bytes: utf8('\n\n') })).rejects.toBeInstanceOf(ImportError);
    const t = await readFile({ name: 'x.csv', bytes: utf8('Ngày,Nội dung,Số tiền\n') });
    expect((await norm(t as never, detectMapping(t.rows).mapping)).rows).toHaveLength(0);
  });

  it('không có tiêu đề: đoán theo nội dung nhưng báo chưa chắc chắn', async () => {
    const t = await readFile({ name: 'x.csv', bytes: utf8('01/03/2026,Cafe,-30000\n02/03/2026,Luong,5000000\n03/03/2026,Xang,-60000\n') });
    const { mapping, confident } = detectMapping(t.rows);
    expect(confident).toBe(false);
    expect(mapping.date).toBe(0); expect(mapping.amount).toBe(2);
  });
});

describe('Excel', () => {
  async function xlsx(rows: unknown[][]) {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sao ke');
    rows.forEach((r) => ws.addRow(r));
    return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }
  it('đọc Excel hợp lệ: ngày kiểu Date, số tiền kiểu số, chuỗi dd/mm/yyyy', async () => {
    const bytes = await xlsx([['Ngày', 'Nội dung', 'Số tiền', 'Mã GD'], [new Date(Date.UTC(2026, 2, 5)), 'Grab', -85000, 'A1'], ['06/03/2026', 'Lương', 7_500_000, 'A2'], [], ['Tổng cộng', '', 7_415_000]]);
    const t = await readFile({ name: 'sk.xlsx', bytes });
    expect(t.kind).toBe('excel');
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    expect(r.rows.map((x) => [x.date, x.type, x.amount, x.bankRef])).toEqual([['2026-03-05', 'expense', 85000, 'A1'], ['2026-03-06', 'income', 7_500_000, 'A2']]);
    expect(r.skipped.length).toBe(1);
  });
  it('Excel hỏng / rỗng → lỗi có ý nghĩa', async () => {
    const bad = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5]);
    await expect(readFile({ name: 'x.xlsx', bytes: bad })).rejects.toThrow(/Không mở được/);
    await expect(readFile({ name: 'x.xlsx', bytes: await xlsx([]) })).rejects.toThrow(/không có dữ liệu/);
  });
});

describe('PDF', () => {
  it('PDF có lớp văn bản: đọc được dòng giao dịch, có cảnh báo heuristic', async () => {
    const pdf = makePdf(['SAO KE TAI KHOAN', 'Ngay   Noi dung   So tien   So du', '05/03/2026 Thanh toan Highlands -45,000 1,455,000', '06/03/2026 Nhan tien Gom Ke +8,000,000 9,455,000', 'Trang 1']);
    const t = await readFile({ name: 'sk.pdf', bytes: pdf });
    expect(t.kind).toBe('pdf');
    expect(t.warnings[0]).toMatch(/suy đoán/);
    const m = detectMapping(t.rows).mapping;
    const r = await norm(t as never, m);
    expect(r.rows.map((x) => [x.date, x.type, x.amount])).toEqual([['2026-03-05', 'expense', 45000], ['2026-03-06', 'income', 8_000_000]]);
  });
  it('PDF bản quét (không có chữ) → báo cần OCR, không giả vờ đọc được', async () => {
    await expect(readFile({ name: 'scan.pdf', bytes: makePdf([]) })).rejects.toMatchObject({ code: 'scanned' });
  });
  it('PDF có chữ nhưng không nhận ra giao dịch → báo chưa hỗ trợ định dạng', async () => {
    await expect(readFile({ name: 'x.pdf', bytes: makePdf(['Day la mot tai lieu bat ky khong phai sao ke ngan hang nao ca, chi la van ban dai du de qua nguong']) })).rejects.toMatchObject({ code: 'unreadable' });
  });
  it('PDF hỏng', async () => {
    await expect(extractPdfLines(utf8('%PDF-1.4\nrác rác rác'))).rejects.toMatchObject({ code: 'unreadable' });
  });
});

describe('phát hiện trùng khi nhập', () => {
  it('nghi trùng giao dịch đã có → mặc định KHÔNG nhập, có lý do, người dùng quyết định', async () => {
    await repo.create('transactions', { type: 'expense', amount: 45000, date: '2026-03-05', accountId, categoryId: 'cat-exp-living', description: 'Thanh toan Highlands Coffee', bankRef: 'FT001' });
    const t = await readFile({ name: 'sk.csv', bytes: utf8(CSV_VN) });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    const dup = r.rows[0]!;
    expect(dup.include).toBe(false);
    expect(dup.duplicates[0]!.reasons.join(' ')).toContain('FT001');
    expect(r.rows[1]!.include).toBe(true);
    // người dùng vẫn chọn nhập → được phép
    dup.include = true;
    const res = await commitImport({ rows: r.rows, table: t, accountId, skippedCount: r.skipped.length, categories });
    expect(res.count).toBe(3);
  });
});

describe('ghi vào sổ chỉ sau khi xác nhận', () => {
  it('xem trước/hủy giữa chừng không ghi gì; xác nhận mới ghi, có lô nhập + nhật ký + lịch sử', async () => {
    const t = await readFile({ name: 'sk.csv', bytes: utf8(CSV_VN) });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    expect(await db.transactions.count()).toBe(0); // chỉ xem trước → chưa ghi
    const res = await commitImport({ rows: r.rows, table: t, accountId, skippedCount: r.skipped.length, categories });
    expect(res.count).toBe(3);
    const txs = await db.transactions.toArray();
    expect(txs).toHaveLength(3);
    expect(txs.every((x) => x.importBatchId === res.batchId && x.source === 'csv' && x.status === 'confirmed')).toBe(true);
    expect(txs.find((x) => x.bankRef === 'FT003')!.categoryId).toBe('cat-exp-family');
    const batch = (await db.importBatches.get(res.batchId))!;
    expect(batch).toMatchObject({ fileName: 'sk.csv', rowCount: 3, skippedCount: 1, kind: 'csv' });
    expect(batch.log.length).toBeGreaterThan(0);
    expect(await db.history.where('collection').equals('importBatches').count()).toBe(1);
  });

  it('lỗi khi lưu → hoàn tác toàn bộ (không ghi nửa chừng)', async () => {
    const t = await readFile({ name: 'sk.csv', bytes: utf8(CSV_VN) });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    await expect(commitImport({ rows: r.rows, table: t, accountId, skippedCount: 1, categories, beforeCommit: () => { throw new Error('đĩa đầy'); } })).rejects.toThrow('đĩa đầy');
    expect(await db.transactions.count()).toBe(0);
    expect(await db.importBatches.count()).toBe(0);
    await expect(commitImport({ rows: r.rows, table: t, accountId: 'acc-khong-ton-tai', skippedCount: 1, categories })).rejects.toThrow(/Tài khoản/);
    expect(await db.transactions.count()).toBe(0);
  });

  it('dòng còn lỗi hoặc không chọn dòng nào → không cho nhập', async () => {
    const t = await readFile({ name: 'x.csv', bytes: utf8('Ngày,Nội dung,Số tiền\n05/03/2026,x,abc\n') });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    await expect(commitImport({ rows: r.rows, table: t, accountId, skippedCount: 0, categories })).rejects.toThrow(/Chưa chọn/);
    r.rows[0]!.include = true;
    await expect(commitImport({ rows: r.rows, table: t, accountId, skippedCount: 0, categories })).rejects.toThrow(/còn lỗi/);
  });

  it('hoàn tác cả lô nhập → vào thùng rác, khôi phục được', async () => {
    const t = await readFile({ name: 'sk.csv', bytes: utf8(CSV_VN) });
    const r = await norm(t as never, detectMapping(t.rows).mapping);
    const res = await commitImport({ rows: r.rows, table: t, accountId, skippedCount: 1, categories });
    expect(await repo.undoImportBatch(res.batchId)).toBe(3);
    expect(await repo.listLive('transactions')).toHaveLength(0);
    expect(await repo.listTrash('transactions')).toHaveLength(3);
  });
});

describe('gợi ý danh mục (quy tắc + lịch sử, không dùng AI)', () => {
  it('học từ lịch sử của chính người dùng', async () => {
    await repo.create('transactions', { type: 'expense', amount: 1, date: '2026-03-01', accountId, categoryId: 'cat-exp-personal', description: 'Pottery Studio Class' });
    const hist = await db.transactions.toArray();
    expect(suggestCategory('POTTERY STUDIO thanh toan', 'expense', categories, hist)).toMatchObject({ categoryId: 'cat-exp-personal', reason: 'Giống các giao dịch trước của bạn' });
    expect(suggestCategory('Không rõ gì cả', 'expense', categories, hist).categoryId).toBeNull();
  });
});
