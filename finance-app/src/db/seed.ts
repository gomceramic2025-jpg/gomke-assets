import { db, kvGet, kvSet } from './db';
import { schemaFor, type RecordOf } from '../domain/schemas';
import { addMonths, monthEnd, monthOf, todayIso, daysInMonth } from '../domain/dates';
import { randomId } from '../crypto/crypto';

const t0 = () => Date.now();
const base = (id: string, isSample = false) => ({ id, rev: 1, createdAt: t0(), updatedAt: t0(), deletedAt: null, purged: false, isSample });

/** ID cố định cho dữ liệu mặc định: hai thiết bị cùng khởi tạo sẽ trùng ID và được gộp (không nhân đôi). */
export const DEFAULT_CATEGORIES: Array<{ id: string; name: string; kind: 'income' | 'expense'; systemKey: string }> = [
  { id: 'cat-inc-gomke', name: 'Tiền nhận từ Gốm Kể', kind: 'income', systemKey: 'income-gomke' },
  { id: 'cat-inc-outside', name: 'Thu nhập bên ngoài', kind: 'income', systemKey: 'income-outside' },
  { id: 'cat-inc-other', name: 'Thu nhập khác', kind: 'income', systemKey: 'income-other' },
  { id: 'cat-inc-interest', name: 'Lãi tiết kiệm hoặc đầu tư', kind: 'income', systemKey: 'income-interest' },
  { id: 'cat-exp-living', name: 'Sinh hoạt', kind: 'expense', systemKey: 'living' },
  { id: 'cat-exp-family', name: 'Gia đình', kind: 'expense', systemKey: 'family' },
  { id: 'cat-exp-personal', name: 'Chi phí cá nhân', kind: 'expense', systemKey: 'personal' },
  { id: 'cat-exp-learning', name: 'Học tập và phát triển bản thân', kind: 'expense', systemKey: 'learning' },
  { id: 'cat-exp-health', name: 'Sức khỏe', kind: 'expense', systemKey: 'health' },
  { id: 'cat-exp-gomke', name: 'Chi phí liên quan đến Gốm Kể', kind: 'expense', systemKey: 'expense-gomke' },
  { id: 'cat-exp-other', name: 'Khoản chi khác', kind: 'expense', systemKey: 'other' },
];

export const DEFAULT_GOALS = [
  { id: 'goal-reserve', name: 'Quỹ dự phòng cá nhân', priority: 1, monthsAhead: 12, systemKey: 'reserve' },
  { id: 'goal-parents-house', name: 'Sửa nhà cho ba mẹ', priority: 2, monthsAhead: 36, systemKey: 'parents-house' },
  { id: 'goal-car', name: 'Mua xe', priority: 3, monthsAhead: 36, systemKey: 'car' },
  { id: 'goal-own-home', name: 'Xây hoặc mua nhà riêng', priority: 4, monthsAhead: 36, systemKey: 'own-home' },
  { id: 'goal-wedding', name: 'Kết hôn và xây dựng gia đình', priority: 5, monthsAhead: 36, systemKey: 'wedding' },
  { id: 'goal-learning', name: 'Học tập và nâng cao chuyên môn', priority: 6, monthsAhead: 36, systemKey: 'learning' },
] as const;

/** Khởi tạo dữ liệu mặc định lần đầu (chỉ chạy một lần). Mục tiêu không rõ số tiền để 0 = "chưa đặt", không bịa số. */
export async function ensureDefaults(): Promise<boolean> {
  if (await kvGet<boolean>('initialized')) return false;
  const today = todayIso();
  const startMonth = monthOf(today);
  await db.transaction('rw', [db.settings, db.categories, db.goals, db.accounts, db.kv, db.outbox, db.syncMeta], async () => {
    if (!(await db.settings.get('settings-main'))) {
      await db.settings.add(schemaFor.settings.parse({ ...base('settings-main') }));
    }
    const s = (await db.settings.get('settings-main'))!;
    for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
      if (!(await db.categories.get(c.id))) await db.categories.add(schemaFor.categories.parse({ ...base(c.id), ...c, order: i }));
    }
    for (const g of DEFAULT_GOALS) {
      if (await db.goals.get(g.id)) continue;
      await db.goals.add(schemaFor.goals.parse({
        ...base(g.id), name: g.name, priority: g.priority, systemKey: g.systemKey,
        targetAmount: g.systemKey === 'reserve' ? s.baseMonthlyExpense * s.reserveMonths : 0,
        deadline: addMonths(startMonth, g.monthsAhead), plannedMonthly: 0, status: 'active',
        note: g.systemKey === 'reserve' ? 'Mặc định = chi phí cơ sở × số tháng dự phòng (chỉnh trong Cài đặt).' : 'Chưa đặt số tiền cần đạt — hãy nhập khi bạn đã có ước tính.',
      }));
    }
    for (const a of [
      { id: 'acc-cash', name: 'Tiền mặt', type: 'cash' as const, order: 0 },
      { id: 'acc-bank', name: 'Tài khoản ngân hàng', type: 'bank' as const, order: 1 },
    ]) {
      if (!(await db.accounts.get(a.id))) await db.accounts.add(schemaFor.accounts.parse({ ...base(a.id), ...a, openingBalance: 0, openingDate: '2020-01-01' }));
    }
    await db.kv.put({ k: 'initialized', v: true });
    // Mọi bản ghi mặc định cần được đồng bộ
    for (const [col, rows] of [['settings', await db.settings.toArray()], ['categories', await db.categories.toArray()], ['goals', await db.goals.toArray()], ['accounts', await db.accounts.toArray()]] as const) {
      for (const r of rows) await db.outbox.put({ key: `${col}:${r.id}`, collection: col, id: r.id, opId: randomId(), baseRev: 0, queuedAt: t0(), attempts: 0 });
    }
  });
  return true;
}

// Bộ sinh số giả ngẫu nhiên có hạt giống → dữ liệu mẫu ổn định, dùng được trong test.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const roundK = (n: number) => Math.round(n / 1000) * 1000;

/** Nạp dữ liệu MẪU (isSample=true): có nhãn, không đồng bộ, xóa riêng được. */
export async function loadSampleData(today = todayIso(), seed = 20260101): Promise<{ transactions: number }> {
  const r = rng(seed);
  const cur = monthOf(today);
  const sampleAcc = [
    { ...base('sample-acc-cash', true), name: 'Tiền mặt (mẫu)', type: 'cash' as const, openingBalance: 2_000_000, openingDate: `${addMonths(cur, -6)}-01`, order: 10 },
    { ...base('sample-acc-bank', true), name: 'Ngân hàng (mẫu)', type: 'bank' as const, openingBalance: 5_000_000, openingDate: `${addMonths(cur, -6)}-01`, order: 11 },
    { ...base('sample-acc-save', true), name: 'Tiết kiệm (mẫu)', type: 'savings' as const, openingBalance: 0, openingDate: `${addMonths(cur, -6)}-01`, order: 12 },
  ].map((a) => schemaFor.accounts.parse(a));
  const txs: RecordOf['transactions'][] = [];
  const mk = (p: Partial<RecordOf['transactions']> & Pick<RecordOf['transactions'], 'type' | 'amount' | 'date' | 'accountId'>) =>
    txs.push(schemaFor.transactions.parse({ ...base(`sample-tx-${txs.length + 1}-${randomId().slice(0, 6)}`, true), recordedAt: t0(), source: 'sample', description: '', ...p }));
  const gomke = 'cat-inc-gomke';
  const exp: Array<[string, string, number, number]> = [
    ['cat-exp-living', 'Ăn uống', 1_800_000, 2_600_000], ['cat-exp-living', 'Điện nước, internet', 450_000, 700_000],
    ['cat-exp-family', 'Gửi ba mẹ', 500_000, 1_000_000], ['cat-exp-personal', 'Cà phê, giải trí', 300_000, 900_000],
    ['cat-exp-learning', 'Khóa học / sách', 0, 800_000], ['cat-exp-health', 'Thuốc, khám', 0, 400_000],
    ['cat-exp-gomke', 'Chi hộ Gốm Kể (tự chi)', 0, 600_000],
  ];
  for (let i = 6; i >= 0; i--) {
    const m = addMonths(cur, -i);
    const last = i === 0 ? Number(today.slice(8, 10)) : daysInMonth(m);
    const day = (n: number) => `${m}-${String(Math.max(1, Math.min(n, last))).padStart(2, '0')}`;
    mk({ type: 'income', amount: roundK(5_000_000 + r() * 6_000_000), date: day(5 + Math.floor(r() * 5)), accountId: 'sample-acc-bank', categoryId: gomke, description: 'Nhận từ Gốm Kể (mẫu)', counterparty: 'Gốm Kể' });
    if (r() > 0.5) mk({ type: 'income', amount: roundK(1_000_000 + r() * 2_500_000), date: day(18 + Math.floor(r() * 8)), accountId: 'sample-acc-bank', categoryId: 'cat-inc-outside', description: 'Việc ngoài (mẫu)' });
    for (const [cat, desc, lo, hi] of exp) {
      if (hi === 0) continue;
      const amt = roundK(lo + r() * (hi - lo));
      if (amt > 0) mk({ type: 'expense', amount: amt, date: day(2 + Math.floor(r() * 26)), accountId: r() > 0.4 ? 'sample-acc-bank' : 'sample-acc-cash', categoryId: cat, description: `${desc} (mẫu)` });
    }
    if (i < 6) mk({ type: 'transfer', amount: 1_000_000, date: day(12), accountId: 'sample-acc-bank', toAccountId: 'sample-acc-save', description: 'Chuyển vào tiết kiệm (mẫu)' });
  }
  mk({ type: 'expense', amount: 200_000, refund: true, date: addMonths(cur, -1) + '-20', accountId: 'sample-acc-bank', categoryId: 'cat-exp-personal', description: 'Hoàn tiền đơn hàng (mẫu)' });
  mk({ type: 'adjustment', amount: -50_000, date: addMonths(cur, -2) + '-28', accountId: 'sample-acc-cash', description: 'Điều chỉnh chênh lệch tiền mặt (mẫu)' });
  const asset = schemaFor.assets.parse({ ...base('sample-asset-gold', true), name: 'Vàng 1 chỉ (mẫu)', type: 'gold', liquidity: 'semi', valuationDate: today, currentValue: 8_000_000, purchaseValue: 7_000_000 });
  const budgets = [['cat-exp-living', 4_500_000], ['cat-exp-personal', 800_000], ['cat-exp-family', 1_000_000]].map(([c, v], i) =>
    schemaFor.budgets.parse({ ...base(`sample-bud-${i + 1}`, true), categoryId: c, monthlyLimit: v, effectiveFrom: addMonths(cur, -6) }));
  await db.transaction('rw', [db.accounts, db.transactions, db.assets, db.budgets], async () => {
    await db.accounts.bulkAdd(sampleAcc);
    await db.transactions.bulkAdd(txs);
    await db.assets.add(asset);
    await db.budgets.bulkAdd(budgets);
  });
  await kvSet('sampleLoaded', true);
  return { transactions: txs.length };
}

export async function hasSampleData(): Promise<boolean> {
  return (await db.accounts.filter((a) => a.isSample).count()) > 0;
}

/** Xóa toàn bộ dữ liệu mẫu (xóa hẳn — chưa từng đồng bộ). Không đụng dữ liệu thật. */
export async function removeSampleData(): Promise<number> {
  let n = 0;
  await db.transaction('rw', [db.accounts, db.transactions, db.assets, db.budgets, db.contributions, db.goals, db.categories, db.importBatches, db.history, db.settings, db.kv], async () => {
    for (const t of [db.transactions, db.accounts, db.assets, db.budgets, db.contributions, db.importBatches, db.history, db.goals, db.categories] as const) {
      const ids = await (t as typeof db.transactions).filter((r) => r.isSample === true).primaryKeys();
      n += ids.length;
      await (t as typeof db.transactions).bulkDelete(ids);
    }
    await db.kv.delete('sampleLoaded');
  });
  return n;
}

export { monthEnd };
