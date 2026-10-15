// Supabase Edge Function (Deno): cầu nối tới nhà cung cấp AI. API key CHỈ nằm ở đây (supabase secrets), không bao giờ ở frontend.
// CHƯA được kiểm thử với dịch vụ thật trong repo này — xem docs/SETUP_SUPABASE.md mục "AI".
// Triển khai: supabase functions deploy ai-proxy   |   supabase secrets set ANTHROPIC_API_KEY=...
import { createClient } from 'npm:@supabase/supabase-js@2';

const MAX_BODY_BYTES = 16 * 1024;          // giới hạn kích thước đầu vào
const DAILY_LIMIT = 20;                     // giới hạn số lần gọi/ngày (kiểm tra ở CSDL)
const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-haiku-5-5';
const TIMEOUT_MS = 25_000;

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `Bạn là trợ lý phân tích tài chính cá nhân cho một người dùng Việt Nam (đơn vị VND).
Quy tắc bắt buộc:
- Chỉ dựa trên dữ liệu tổng hợp được cung cấp. Nếu dữ liệu không đủ, nói rõ "chưa đủ dữ liệu", không bịa số.
- Bạn KHÔNG thực hiện hành động nào: không tạo giao dịch, không sửa số dư, không xóa, không chuyển tiền, không đổi mục tiêu. Chỉ phân tích và đề xuất.
- Không hứa chắc chắn đạt mục tiêu. Nêu giả định.
- Trả lời tiếng Việt, ngắn gọn, thực tế.
- Trả về DUY NHẤT một JSON: {"answer": string, "budgetSuggestions": [{"categoryId": string, "monthlyLimit": integer, "reason": string}]}. budgetSuggestions có thể rỗng.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const auth = req.headers.get('Authorization');
  if (!auth) return json(401, { error: 'auth' });

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: 'Dữ liệu gửi quá lớn' });
  let body: { question?: string; context?: unknown };
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'json' }); }
  if (typeof body.question !== 'string' || body.question.length === 0 || body.question.length > 500) return json(400, { error: 'Câu hỏi không hợp lệ (1–500 ký tự)' });

  // Gọi RPC bằng chính JWT của người dùng → RLS/is_owner() áp dụng ở máy chủ
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: quota, error: qErr } = await sb.rpc('ai_take_quota', { p_limit: DAILY_LIMIT });
  if (qErr) return json(qErr.code === '42501' ? 403 : 401, { error: qErr.code === '42501' ? 'Tài khoản không được phép' : 'auth' });
  if (!quota?.allowed) return json(429, { error: `Đã dùng hết ${DAILY_LIMIT} lượt AI hôm nay` });

  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return json(503, { error: 'Máy chủ chưa cấu hình khóa AI' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 800, system: SYSTEM,
        messages: [{ role: 'user', content: `Dữ liệu tổng hợp (JSON):\n${JSON.stringify(body.context)}\n\nCâu hỏi: ${body.question}` }],
      }),
    });
    if (r.status === 429) return json(429, { error: 'Nhà cung cấp AI đang giới hạn tốc độ, thử lại sau' });
    if (!r.ok) return json(502, { error: `Nhà cung cấp AI trả lỗi ${r.status}` });
    const out = await r.json();
    const text: string = out?.content?.[0]?.text ?? '';
    let parsed: unknown;
    try { parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { parsed = { answer: text, budgetSuggestions: [] }; }
    return json(200, parsed);
  } catch (e) {
    return json((e as Error).name === 'AbortError' ? 504 : 502, { error: (e as Error).name === 'AbortError' ? 'AI phản hồi quá lâu' : 'Không gọi được nhà cung cấp AI' });
  } finally { clearTimeout(timer); }
});
