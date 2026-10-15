import { useMemo, useRef, useState } from 'react';
import * as repo from '../../db/repo';
import type { Ledger } from '../hooks';
import { analyzeRules } from '../../ai/rules';
import { AiError, askAi, buildAiContext, prepareRequest, type AiAnswer } from '../../ai/llm';
import { isSupabaseConfigured } from '../../sync/supabase';
import { formatMonthVi, monthOf } from '../../domain/dates';
import { formatVnd } from '../../domain/money';
import { Banner, Confirm, Empty, useAction } from '../components/common';

const TONE = { info: 'info', good: 'good', warning: 'warn', risk: 'bad' } as const;

export function Assistant({ L }: { L: Ledger }) {
  const analysis = useMemo(() => analyzeRules({ today: L.today, accounts: L.accounts, txs: L.transactions, categories: L.categories, budgets: L.budgets, goals: L.goals, contribs: L.contributions, settings: L.settings }), [L]);
  const [q, setQ] = useState('');
  const [prep, setPrep] = useState<{ body: string; bytes: number; pretty: string } | null>(null);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const { run } = useAction();
  const name = (id: string) => L.categories.find((c) => c.id === id)?.name ?? id;
  const canAi = L.settings.aiEnabled && isSupabaseConfigured();

  const prepare = () => { setErr(''); setAnswer(null); try { const ctx = buildAiContext(L.transactions, L.categories, L.budgets, L.goals, L.settings, L.today); const p = prepareRequest(q, ctx); setPrep({ ...p, pretty: JSON.stringify(JSON.parse(p.body), null, 2) }); } catch (e) { setErr(e instanceof Error ? e.message : 'Lỗi'); } };
  const send = async () => {
    if (!prep) return; setLoading(true); setErr(''); ctl.current = new AbortController();
    try { setAnswer(await askAi(prep.body, { enabled: L.settings.aiEnabled, signal: ctl.current.signal })); setPrep(null); }
    catch (e) { setErr(e instanceof AiError ? e.message : 'Lỗi không xác định'); setPrep(null); } finally { setLoading(false); }
  };

  return <>
    <h1>Trợ lý AI</h1>
    <Banner kind="info"><strong>Phân tích theo quy tắc (không phải AI tạo sinh)</strong> — chạy hoàn toàn trên máy bạn, không gửi dữ liệu đi đâu. Phần AI tạo sinh bên dưới là tùy chọn, tắt mặc định, và chỉ chạy khi bạn chủ động hỏi.</Banner>

    <section className="card" style={{ marginBottom: 12 }}><h2>Nhận định từ dữ liệu của bạn · {formatMonthVi(monthOf(L.today))}</h2>
      {!analysis.enoughData && <p className="small muted">Mới có {analysis.monthsOfData} tháng dữ liệu thu chi — các nhận định dưới đây có độ tin cậy thấp, và dự báo dài hạn chưa hiển thị.</p>}
      {analysis.insights.length === 0 ? <Empty title="Chưa có nhận định nào" /> : analysis.insights.map((i) => <div key={i.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><span className={`badge ${TONE[i.severity]}`}>{{ info: 'Thông tin', good: 'Tốt', warning: 'Lưu ý', risk: 'Rủi ro' }[i.severity]}</span> <strong>{i.title}</strong><div>{i.detail}</div>{i.evidence && <div className="small muted">Số liệu: {i.evidence}</div>}</div>)}
    </section>

    <section className="card"><h2>Hỏi AI (tùy chọn)</h2>
      {!L.settings.aiEnabled ? <p className="muted">AI đang tắt. Bật trong <a href="#/cai-dat">Cài đặt</a> nếu bạn muốn. Phần mềm vẫn hoạt động đầy đủ khi tắt.</p> :
        !canAi ? <Banner kind="warn">AI cần cấu hình Supabase và triển khai Edge Function <code>ai-proxy</code> (khóa API nằm ở máy chủ, không ở trình duyệt). Chưa cấu hình nên chưa gọi được. Xem <code>docs/SETUP_SUPABASE.md</code>.</Banner> : <>
          <label className="field"><span>Câu hỏi (tối đa 500 ký tự)</span><textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="VD: Tháng nào tôi chi nhiều bất thường và vì sao?" /></label>
          <button className="btn primary" disabled={!q.trim() || loading} onClick={prepare}>Xem dữ liệu sẽ gửi…</button>
          <p className="small muted">Không tự gọi khi mở ứng dụng. Giới hạn 20 lượt/ngày và 12 KB mỗi lần, kiểm tra ở máy chủ.</p></>}
      {err && <Banner kind="error">{err}</Banner>}
      {answer && <div style={{ marginTop: 10 }}><h3>Trả lời của AI</h3><p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p><p className="small muted">Đây là đề xuất tham khảo, không phải lời khuyên tài chính chắc chắn. AI không thay đổi dữ liệu của bạn.</p>
        {answer.budgetSuggestions.length > 0 && <><h3>Đề xuất ngân sách (bạn duyệt từng mục)</h3><table><tbody>{answer.budgetSuggestions.filter((s) => L.categories.some((c) => c.id === s.categoryId)).map((s) => <tr key={s.categoryId}><td>{name(s.categoryId)}</td><td className="right">{formatVnd(s.monthlyLimit)}</td><td className="small">{s.reason}</td><td><button className="btn small" onClick={() => void run(async () => { await repo.create('budgets', { categoryId: s.categoryId, monthlyLimit: s.monthlyLimit, effectiveFrom: monthOf(L.today), source: 'ai-approved' } as never); }, 'Đã áp dụng ngân sách')}>Duyệt & áp dụng</button></td></tr>)}</tbody></table></>}</div>}
    </section>

    {prep && <Confirm title="Dữ liệu sẽ được gửi tới dịch vụ AI" confirmLabel={`Gửi (${prep.bytes} byte)`} onCancel={() => setPrep(null)} onConfirm={() => void send()}>
      <Banner kind="warn">Dữ liệu <strong>tổng hợp</strong> dưới đây sẽ rời khỏi thiết bị của bạn, đi qua máy chủ của bạn tới nhà cung cấp AI. Không có nội dung từng giao dịch, số tài khoản hay khóa mã hóa. Bạn có thể hủy.</Banner>
      <pre className="small" style={{ maxHeight: 260, overflow: 'auto', background: 'var(--surface-2)', padding: 8, borderRadius: 8 }}>{prep.pretty}</pre></Confirm>}
    {loading && <Banner kind="info" actions={<button className="btn small" onClick={() => ctl.current?.abort()}>Hủy</button>}>Đang chờ AI…</Banner>}
  </>;
}
