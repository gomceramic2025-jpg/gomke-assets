import type { Account, Category, Transaction } from '../domain/schemas';
import { formatDateVi } from '../domain/dates';
import type { CashflowReport, MonthPoint } from '../domain/calc';

/** Chống "CSV/Excel formula injection": ô văn bản bắt đầu bằng = + - @ tab sẽ được thêm dấu ' phía trước. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
const q = (v: string | number): string => {
  const s = typeof v === 'number' ? String(v) : safeCell(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n'; // BOM để Excel đọc đúng UTF-8
}

export function transactionsTable(txs: readonly Transaction[], accounts: readonly Account[], categories: readonly Category[]): Array<Array<string | number>> {
  const acc = new Map(accounts.map((a) => [a.id, a.name]));
  const cat = new Map(categories.map((c) => [c.id, c.name]));
  const typeVi = { income: 'Thu nhập', expense: 'Chi phí', transfer: 'Chuyển tiền', adjustment: 'Điều chỉnh' } as const;
  const head: Array<string | number> = ['Ngày', 'Loại', 'Số tiền (VND)', 'Danh mục', 'Tài khoản', 'Tài khoản đích', 'Nội dung', 'Người nhận/nguồn thu', 'Ghi chú', 'Thẻ', 'Nguồn', 'Mã giao dịch', 'Hoàn tiền', 'Dữ liệu mẫu'];
  const body = txs.filter((t) => !t.deletedAt && !t.purged && t.status === 'confirmed').sort((a, b) => a.date.localeCompare(b.date)).map((t) => [
    formatDateVi(t.date), typeVi[t.type], t.type === 'expense' && !t.refund ? -t.amount : t.amount, t.categoryId ? cat.get(t.categoryId) ?? '' : '', acc.get(t.accountId) ?? '',
    t.toAccountId ? acc.get(t.toAccountId) ?? '' : '', t.description, t.counterparty, t.note, t.tags.join(' '), t.source, t.bankRef, t.refund ? 'Có' : '', t.isSample ? 'Mẫu' : '',
  ]);
  return [head, ...body];
}

export async function toXlsx(sheets: Array<{ name: string; rows: Array<Array<string | number>> }>): Promise<Uint8Array<ArrayBuffer>> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gốm Kể Finance';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    for (const r of s.rows) ws.addRow(r.map((c) => (typeof c === 'string' ? safeCell(c) : c)));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((col) => { col.width = 22; });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export function cashflowTable(r: CashflowReport): Array<Array<string | number>> {
  return [
    ['Khoản mục', 'Số tiền (VND)'],
    ['Số dư đầu kỳ', r.opening], ['Số dư đầu của tài khoản mở trong kỳ', r.newAccountsOpening], ['Tiền vào (thu nhập)', r.inflow], ['Hoàn tiền', r.refunds],
    ['Tiền ra (chi phí)', -r.outflow], ['Chuyển khoản nội bộ (ròng)', r.transfersNet], ['Điều chỉnh', r.adjustments], ['Số dư cuối kỳ', r.closing],
  ];
}
export function monthsTable(m: readonly MonthPoint[]): Array<Array<string | number>> {
  return [['Tháng', 'Thu nhập', 'Chi phí', 'Chênh lệch'], ...m.map((x) => [x.month, x.income, x.expense, x.net])];
}

export function downloadBlob(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
