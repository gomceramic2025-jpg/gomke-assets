/**
 * AI tạo sinh (tùy chọn, tắt mặc định). API key nằm ở Edge Function, không ở frontend.
 * Quy tắc: không tự gọi khi mở dashboard; người dùng thấy CHÍNH XÁC dữ liệu sẽ gửi và bấm xác nhận; có hủy; có giới hạn kích thước.
 * AI chỉ trả lời/đề xuất — không có hàm nào ở đây ghi vào cơ sở dữ liệu.
 */
import type { Budget, Category, Goal, Settings } from '../domain/schemas';
import { categoryTotals, monthlySeries, monthsWithData, type TxLike } from '../domain/calc';
import { addMonths, monthEnd, monthOf, monthStart, type IsoDate } from '../domain/dates';
import { getSupabase, isSupabaseConfigured } from '../sync/supabase';

export const MAX_AI_PAYLOAD_BYTES = 12 * 1024;
export const MAX_QUESTION_CHARS = 500;

export interface AiContext {
  note: string; currency: 'VND'; month: string;
  monthly: Array<{ month: string; income: number; expense: number }>;
  expenseByCategory: Array<{ month: string; category: string; categoryId: string; total: number }>;
  budgets: Array<{ categoryId: string; category: string; monthlyLimit: number }>;
  goals: Array<{ name: string; target: number; deadline: string; priority: number; plannedMonthly: number }>;
  baseMonthlyExpense: number; reserveMonths: number;
}

/** Xóa chuỗi giống số tài khoản/điện thoại/email/token khỏi văn bản tự do. */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\b(?:eyJ[\w-]{10,}|sk-[\w-]{10,}|[A-Za-z0-9_-]{32,})\b/g, '[token]')
    .replace(/(?:\+?84|0)[\s.-]?\d(?:[\s.-]?\d){8,9}\b/g, '[sđt]')
    .replace(/\b\d(?:[\s-]?\d){5,}\b/g, '[số]');
}

/** Chỉ số liệu TỔNG HỢP của tối đa 6 tháng — không gửi nội dung từng giao dịch, số tài khoản, ghi chú. */
export function buildAiContext(txs: readonly TxLike[], categories: readonly Category[], budgets: readonly Budget[], goals: readonly Goal[], settings: Settings, today: IsoDate): AiContext {
  const cur = monthOf(today);
  const months = monthsWithData(txs).slice(-6);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return {
    note: 'Dữ liệu đã được tổng hợp trên thiết bị người dùng; không chứa nội dung giao dịch.', currency: 'VND', month: cur,
    monthly: monthlySeries(txs, months).map((p) => ({ month: p.month, income: p.income, expense: p.expense })),
    expenseByCategory: months.flatMap((m) => categoryTotals(txs, monthStart(m), monthEnd(m), 'expense').filter((c) => c.categoryId).map((c) => ({ month: m, category: name.get(c.categoryId!) ?? '', categoryId: c.categoryId!, total: c.total }))),
    budgets: budgets.filter((b) => !b.deletedAt && !b.purged).map((b) => ({ categoryId: b.categoryId, category: name.get(b.categoryId) ?? '', monthlyLimit: b.monthlyLimit })),
    goals: goals.filter((g) => !g.deletedAt && !g.purged).map((g) => ({ name: g.name, target: g.targetAmount, deadline: g.deadline, priority: g.priority, plannedMonthly: g.plannedMonthly })),
    baseMonthlyExpense: settings.baseMonthlyExpense, reserveMonths: settings.reserveMonths,
  };
}

export class AiError extends Error {
  constructor(message: string, readonly code: 'disabled' | 'not-configured' | 'too-large' | 'invalid' | 'auth' | 'rate' | 'timeout' | 'server' | 'cancelled') { super(message); this.name = 'AiError'; }
}

export function prepareRequest(question: string, ctx: AiContext): { body: string; bytes: number } {
  const raw = question.trim();
  if (!raw) throw new AiError('Hãy nhập câu hỏi', 'invalid');
  const q = redact(raw);
  if (raw.length > MAX_QUESTION_CHARS) throw new AiError(`Câu hỏi quá dài (tối đa ${MAX_QUESTION_CHARS} ký tự)`, 'too-large');
  const body = JSON.stringify({ question: q, context: ctx });
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_AI_PAYLOAD_BYTES) throw new AiError(`Dữ liệu gửi đi quá lớn (${bytes} > ${MAX_AI_PAYLOAD_BYTES} byte)`, 'too-large');
  return { body, bytes };
}

export interface AiAnswer { answer: string; budgetSuggestions: Array<{ categoryId: string; monthlyLimit: number; reason: string }> }

export async function askAi(body: string, opts: { enabled: boolean; signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch; accessToken?: string; baseUrl?: string }): Promise<AiAnswer> {
  if (!opts.enabled) throw new AiError('AI đang tắt trong Cài đặt', 'disabled');
  const base = opts.baseUrl ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
  if (!opts.baseUrl && !isSupabaseConfigured()) throw new AiError('Cần cấu hình Supabase và triển khai Edge Function ai-proxy để dùng AI', 'not-configured');
  const token = opts.accessToken ?? (await getSupabase()?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new AiError('Cần đăng nhập để dùng AI', 'auth');
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(new AiError('AI phản hồi quá lâu', 'timeout')), opts.timeoutMs ?? 30_000);
  opts.signal?.addEventListener('abort', () => ctl.abort(new AiError('Đã hủy', 'cancelled')));
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${base}/functions/v1/ai-proxy`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '' }, body });
    if (res.status === 401 || res.status === 403) throw new AiError('Không có quyền dùng AI (đăng nhập lại hoặc tài khoản không được phép)', 'auth');
    if (res.status === 429) throw new AiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Đã hết lượt AI hoặc bị giới hạn tốc độ', 'rate');
    if (res.status === 413) throw new AiError('Dữ liệu gửi quá lớn', 'too-large');
    if (!res.ok) throw new AiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Lỗi máy chủ AI (${res.status})`, 'server');
    const j = (await res.json()) as Partial<AiAnswer>;
    return {
      answer: typeof j.answer === 'string' ? j.answer.slice(0, 4000) : '',
      budgetSuggestions: Array.isArray(j.budgetSuggestions) ? j.budgetSuggestions.filter((s) => s && typeof s.categoryId === 'string' && Number.isSafeInteger(s.monthlyLimit) && s.monthlyLimit >= 0).slice(0, 12).map((s) => ({ categoryId: s.categoryId, monthlyLimit: s.monthlyLimit, reason: String(s.reason ?? '').slice(0, 300) })) : [],
    };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (ctl.signal.aborted && ctl.signal.reason instanceof AiError) throw ctl.signal.reason;
    throw new AiError('Không kết nối được dịch vụ AI', 'server');
  } finally { clearTimeout(timeout); }
}

export { addMonths };
