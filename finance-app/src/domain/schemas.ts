import { z } from 'zod';
import { isValidIsoDate, isValidIsoMonth } from './dates';
import { MAX_VND } from './money';

export const SCHEMA_VERSION = 1;

const vnd = z.number().int('Số tiền phải là số nguyên đồng').refine((n) => Math.abs(n) <= MAX_VND, 'Số tiền vượt giới hạn');
const vndNonNeg = vnd.refine((n) => n >= 0, 'Không được âm');
const isoDate = z.string().refine(isValidIsoDate, 'Ngày không hợp lệ (cần YYYY-MM-DD)');
const isoMonth = z.string().refine(isValidIsoMonth, 'Tháng không hợp lệ (cần YYYY-MM)');
const text = (max: number) => z.string().trim().max(max);
const id = z.string().min(8).max(64);

/** Trường chung cho mọi bản ghi đồng bộ được. */
export const baseFields = {
  id,
  rev: z.number().int().min(1), // tăng mỗi lần sửa cục bộ
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable().default(null), // xóa mềm / tombstone
  purged: z.boolean().default(false), // đã xóa vĩnh viễn (chỉ còn tombstone)
  isSample: z.boolean().default(false), // dữ liệu mẫu — xóa riêng được
};

export const TX_TYPES = ['income', 'expense', 'transfer', 'adjustment'] as const;
export type TxType = (typeof TX_TYPES)[number];
export const TX_SOURCES = ['manual', 'excel', 'csv', 'pdf', 'sample'] as const;

export const transactionSchema = z.object({
  ...baseFields,
  type: z.enum(TX_TYPES),
  /** income/expense/transfer: > 0. adjustment: khác 0, có dấu (+ tăng, − giảm số dư). */
  amount: vnd.refine((n) => n !== 0, 'Số tiền phải khác 0'),
  /** Chỉ cho expense: true = hoàn tiền (giảm chi phí, tăng số dư). */
  refund: z.boolean().default(false),
  date: isoDate, // ngày giao dịch
  recordedAt: z.number().int(), // ngày ghi nhận vào sổ
  categoryId: id.nullable().default(null),
  accountId: id, // tài khoản nguồn (hoặc tài khoản chịu tác động)
  toAccountId: id.nullable().default(null), // chỉ cho transfer
  description: text(300).default(''),
  counterparty: text(120).default(''),
  note: text(1000).default(''),
  tags: z.array(text(40)).max(20).default([]),
  source: z.enum(TX_SOURCES).default('manual'),
  importBatchId: id.nullable().default(null),
  bankRef: text(80).default(''),
  status: z.enum(['confirmed', 'pending']).default('confirmed'),
}).superRefine((t, ctx) => {
  if (t.type === 'adjustment') {
    // dấu tùy ý, đã kiểm tra khác 0
  } else if (t.amount <= 0) {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Số tiền phải lớn hơn 0' });
  }
  if (t.type === 'transfer') {
    if (!t.toAccountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Chuyển tiền cần tài khoản đích' });
    else if (t.toAccountId === t.accountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Tài khoản đích phải khác tài khoản nguồn' });
  } else if (t.toAccountId) {
    ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Chỉ giao dịch chuyển tiền mới có tài khoản đích' });
  }
  if (t.refund && t.type !== 'expense') ctx.addIssue({ code: 'custom', path: ['refund'], message: 'Hoàn tiền chỉ áp dụng cho chi phí' });
  if ((t.type === 'income' || t.type === 'expense') && !t.categoryId) {
    ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Cần chọn danh mục' });
  }
});
export type Transaction = z.infer<typeof transactionSchema>;

export const ACCOUNT_TYPES = ['cash', 'bank', 'ewallet', 'savings'] as const;
export const accountSchema = z.object({
  ...baseFields,
  name: text(80).min(1, 'Cần nhập tên'),
  type: z.enum(ACCOUNT_TYPES),
  /** Số dư tại ngày openingDate (số dư đầu). Số dư hiện tại = số dư đầu + giao dịch từ openingDate. */
  openingBalance: vnd,
  openingDate: isoDate,
  /** Chỉ lưu 4 số cuối nếu cần; không lưu số tài khoản đầy đủ. */
  last4: text(4).default(''),
  archived: z.boolean().default(false),
  order: z.number().int().default(0),
});
export type Account = z.infer<typeof accountSchema>;

export const categorySchema = z.object({
  ...baseFields,
  name: text(80).min(1, 'Cần nhập tên'),
  kind: z.enum(['income', 'expense']),
  order: z.number().int().default(0),
  archived: z.boolean().default(false),
  /** Khóa mặc định của hệ thống (để thống kê/ gợi ý) */
  systemKey: text(40).default(''),
});
export type Category = z.infer<typeof categorySchema>;

export const ASSET_TYPES = ['cash', 'bank', 'savings', 'gold', 'vehicle', 'property', 'investment', 'other'] as const;
export const LIQUIDITY = ['liquid', 'semi', 'illiquid'] as const;
export const assetSchema = z.object({
  ...baseFields,
  name: text(100).min(1, 'Cần nhập tên'),
  type: z.enum(ASSET_TYPES),
  liquidity: z.enum(LIQUIDITY),
  valuationDate: isoDate,
  currentValue: vndNonNeg,
  purchaseValue: vndNonNeg.nullable().default(null),
  note: text(1000).default(''),
});
export type Asset = z.infer<typeof assetSchema>;

export const goalSchema = z.object({
  ...baseFields,
  name: text(100).min(1, 'Cần nhập tên'),
  /** 0 = chưa đặt số tiền cần đạt (chưa thể dự báo) */
  targetAmount: vndNonNeg,
  deadline: isoMonth, // tháng hạn chót
  priority: z.number().int().min(1).max(99), // 1 = cao nhất
  plannedMonthly: vndNonNeg, // khoản đóng góp dự kiến hằng tháng (KẾ HOẠCH, chưa phải tiền thực)
  status: z.enum(['active', 'paused', 'done']).default('active'),
  note: text(1000).default(''),
  systemKey: text(40).default(''),
});
export type Goal = z.infer<typeof goalSchema>;

/** Phân bổ tiền THỰC TẾ đã có sang mục tiêu. Không tạo tiền mới. */
export const contributionSchema = z.object({
  ...baseFields,
  goalId: id,
  amount: vnd.refine((n) => n !== 0, 'Số tiền phải khác 0'), // âm = rút khỏi mục tiêu
  date: isoDate,
  sourceTxId: id.nullable().default(null), // giao dịch chuyển tiền nguồn (nếu có) — mỗi giao dịch chỉ gán cho một mục tiêu
  note: text(300).default(''),
});
export type Contribution = z.infer<typeof contributionSchema>;

export const budgetSchema = z.object({
  ...baseFields,
  categoryId: id,
  /** Hạn mức mỗi tháng áp dụng từ tháng effectiveFrom trở đi (bản ghi mới nhất ≤ tháng xem). */
  monthlyLimit: vndNonNeg,
  effectiveFrom: isoMonth,
  source: z.enum(['user', 'ai-approved']).default('user'),
});
export type Budget = z.infer<typeof budgetSchema>;

export const importBatchSchema = z.object({
  ...baseFields,
  fileName: text(200),
  kind: z.enum(['csv', 'excel', 'pdf']),
  rowCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  accountId: id,
  fileHash: text(80).default(''),
  note: text(500).default(''),
  /** Nhật ký cảnh báo/lỗi khi nhập (không chứa nội dung giao dịch) */
  log: z.array(text(300)).max(200).default([]),
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

export const settingsSchema = z.object({
  ...baseFields,
  displayName: text(80).default('Hy Nguyễn'),
  currency: z.literal('VND').default('VND'),
  baseMonthlyExpense: vndNonNeg.default(5_000_000), // chi phí sinh hoạt tham khảo
  reserveMonths: z.number().int().min(1).max(36).default(3),
  planMonths: z.number().int().min(1).max(120).default(36),
  /** Chính sách ghi nhận thu nhập: 'received' = chỉ khi thực nhận tiền */
  incomePolicy: z.enum(['received']).default('received'),
  /** Tổng nghĩa vụ tài chính khai báo (tùy chọn). null = CHƯA khai báo, không có nghĩa là không nợ. */
  declaredLiabilities: vndNonNeg.nullable().default(null),
  ownerEmails: z.array(text(200)).default([]),
  aiEnabled: z.boolean().default(false),
  autoBackup: z.boolean().default(true),
  backupKeep: z.number().int().min(1).max(60).default(7),
});
export type Settings = z.infer<typeof settingsSchema>;

export const historySchema = z.object({
  ...baseFields,
  ts: z.number().int(),
  collection: z.string(),
  recordId: z.string(),
  action: z.enum(['create', 'update', 'delete', 'restore', 'purge', 'import', 'restore-backup']),
  /** Chỉ lưu tên trường đổi + giá trị trước/sau (đã giới hạn độ dài) */
  changes: z.array(z.object({ field: z.string(), before: z.unknown().optional(), after: z.unknown().optional() })).max(40).default([]),
  summary: text(300).default(''),
});
export type HistoryEntry = z.infer<typeof historySchema>;

export const SYNC_COLLECTIONS = [
  'settings', 'accounts', 'categories', 'transactions', 'assets', 'goals', 'contributions', 'budgets', 'importBatches', 'history',
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export const schemaFor = {
  settings: settingsSchema,
  accounts: accountSchema,
  categories: categorySchema,
  transactions: transactionSchema,
  assets: assetSchema,
  goals: goalSchema,
  contributions: contributionSchema,
  budgets: budgetSchema,
  importBatches: importBatchSchema,
  history: historySchema,
} as const;

export interface RecordBase {
  id: string; rev: number; createdAt: number; updatedAt: number; deletedAt: number | null; purged: boolean; isSample: boolean;
}
export type RecordOf = {
  settings: Settings; accounts: Account; categories: Category; transactions: Transaction; assets: Asset;
  goals: Goal; contributions: Contribution; budgets: Budget; importBatches: ImportBatch; history: HistoryEntry;
};
export { isoMonth as isoMonthSchema, isoDate as isoDateSchema };
