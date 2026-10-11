import type { Transaction } from './schemas';
import { daysBetween } from './dates';

/** Chuẩn hóa nội dung để so sánh: bỏ dấu, chữ thường, bỏ số/ký tự thừa. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

export interface Candidate {
  date: string; amount: number; type: Transaction['type']; accountId: string; description: string; bankRef?: string;
}
export interface DuplicateMatch { existingId: string; score: number; level: 'strong' | 'possible'; reasons: string[] }

type Ref = Pick<Transaction, 'id' | 'date' | 'amount' | 'type' | 'accountId' | 'description' | 'bankRef' | 'deletedAt' | 'purged'>;

/**
 * Tìm giao dịch có thể trùng. KHÔNG tự xóa/bỏ: chỉ trả lý do để người dùng quyết định.
 * Tín hiệu: mã giao dịch ngân hàng, ngày, số tiền, tài khoản, nội dung chuẩn hóa.
 */
export function findDuplicates(c: Candidate, existing: readonly Ref[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const e of existing) {
    if (e.deletedAt || e.purged) continue;
    const reasons: string[] = [];
    let score = 0;
    const sameAcc = e.accountId === c.accountId;
    const sameAmt = e.amount === c.amount && e.type === c.type;
    const dd = Math.abs(daysBetween(e.date, c.date));
    if (c.bankRef && e.bankRef && c.bankRef === e.bankRef) {
      score += 70; reasons.push(`Trùng mã giao dịch ngân hàng (${c.bankRef})`);
    }
    if (sameAmt && sameAcc) {
      if (dd === 0) { score += 40; reasons.push('Cùng ngày, cùng số tiền, cùng tài khoản'); }
      else if (dd <= 2) { score += 20; reasons.push(`Cùng số tiền và tài khoản, lệch ${dd} ngày`); }
      const sim = tokenSimilarity(c.description, e.description);
      if (sim >= 0.8) { score += 25; reasons.push('Nội dung gần như giống nhau'); }
      else if (sim >= 0.5) { score += 12; reasons.push('Nội dung khá giống nhau'); }
    }
    if (score >= 50) out.push({ existingId: e.id, score: Math.min(score, 100), level: score >= 70 ? 'strong' : 'possible', reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}
