import { useState } from 'react';
import { syncController, REQUIRE_LOGIN } from '../../sync/controller';
import { OWNER_EMAIL_HINT } from '../../sync/supabase';
import { Banner, useAction } from '../components/common';
import { useSync } from '../hooks';

export function LoginPage({ gate }: { gate?: boolean }) {
  const s = useSync();
  const { run, busy } = useAction();
  const [err, setErr] = useState('');
  return <div style={{ maxWidth: 520 }}>
    <h1>Đăng nhập</h1>
    <p className="muted">Đăng nhập Google chỉ để xác thực danh tính khi đồng bộ. Google <strong>không</strong> giữ khóa giải mã dữ liệu tài chính của bạn.</p>
    {!s.configured && <Banner kind="warn"><strong>Chưa cấu hình đồng bộ trực tuyến.</strong> Ứng dụng đang chạy ở chế độ cục bộ: dữ liệu chỉ nằm trên thiết bị này, không đăng nhập, không đồng bộ sang iPhone. Để bật, điền <code>VITE_SUPABASE_URL</code> và <code>VITE_SUPABASE_ANON_KEY</code> (xem hướng dẫn trong <code>docs/SETUP_SUPABASE.md</code>). Không có đăng nhập giả lập.</Banner>}
    {s.denied && <Banner kind="error">{s.denied}</Banner>}
    {err && <Banner kind="error">{err}</Banner>}
    {s.configured && s.email && <div className="card"><p>Đang đăng nhập: <strong>{s.email}</strong></p><button className="btn" disabled={busy} onClick={() => void run(() => syncController.signOutNow(), 'Đã đăng xuất')}>Đăng xuất</button></div>}
    {s.configured && !s.email && <div className="card">
      <p>Chỉ chủ sở hữu được cấu hình mới truy cập được dữ liệu đồng bộ{OWNER_EMAIL_HINT ? ` (${OWNER_EMAIL_HINT})` : ''}. Kiểm tra quyền thực hiện ở máy chủ.</p>
      <button className="btn primary" disabled={busy} onClick={() => void run(async () => { try { await syncController.signIn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Không đăng nhập được'); } })}>Đăng nhập bằng Google</button>
    </div>}
    {!gate && !REQUIRE_LOGIN && <p className="small muted" style={{ marginTop: 12 }}>Bạn vẫn dùng đầy đủ ứng dụng ở chế độ cục bộ mà không cần đăng nhập.</p>}
  </div>;
}
