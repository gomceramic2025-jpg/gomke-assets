import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Ledger } from '../hooks';
import { useSync } from '../hooks';
import { STATUS_LABEL, syncController } from '../../sync/controller';
import { Banner, Confirm, Empty, Field, Modal, useAction } from '../components/common';

export function SyncPage({ L: _L }: { L: Ledger }) {
  const s = useSync();
  const { run, busy } = useAction();
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [joinText, setJoinText] = useState('');
  const [confirmRotate, setConfirmRotate] = useState(false);
  const conflicts = useLiveQuery(() => db.conflicts.toArray(), [], []);
  const tone = s.status === 'synced' ? 'good' : s.status === 'conflict' || s.status === 'failed' || s.status === 'auth' ? 'bad' : s.status === 'syncing' || s.status === 'offline' ? 'warn' : 'info';

  return <>
    <div className="topbar"><h1 className="grow">Đồng bộ thiết bị</h1><button className="btn primary" disabled={busy || !s.email || !s.hasKey} onClick={() => void run(async () => { await syncController.syncNow(); })}>Đồng bộ ngay</button></div>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row"><span className={`badge ${tone}`} role="status">{STATUS_LABEL[s.status]}</span>
        {s.pending > 0 && <span className="small muted">{s.pending} thay đổi chờ gửi lên máy chủ</span>}
        {s.lastSyncedAt && <span className="small muted">Lần đồng bộ thành công gần nhất: {new Date(s.lastSyncedAt).toLocaleString('vi-VN')}</span>}</div>
      {s.error && <p className="neg small" role="alert">{s.error}</p>}
      <p className="small muted">“Đã đồng bộ” chỉ hiện khi máy chủ đã xác nhận nhận hết thay đổi của thiết bị này. Khi mất mạng, thay đổi nằm trong hàng đợi và tự gửi lại khi có mạng.</p>
    </div>

    {!s.configured && <Banner kind="warn"><strong>Đồng bộ trực tuyến chưa được cấu hình.</strong> Dữ liệu hiện chỉ nằm trên thiết bị này; <strong>chưa có gì được đồng bộ sang iPhone</strong>. Làm theo <code>docs/SETUP_SUPABASE.md</code> và <code>docs/SETUP_GOOGLE_OAUTH.md</code>, rồi điền <code>.env.local</code>. Bạn vẫn có thể tạo khóa khôi phục và sao lưu ngay bây giờ.</Banner>}
    {s.configured && !s.email && <Banner kind="info" actions={<a className="btn small primary" href="#/dang-nhap">Đăng nhập</a>}>Cần đăng nhập Google (xác thực danh tính) để đồng bộ.</Banner>}
    {s.denied && <Banner kind="error">{s.denied}</Banner>}

    <section className="card" style={{ marginBottom: 12 }}><h2>1. Khóa mã hóa</h2>
      <p>Dữ liệu tài chính được mã hóa <strong>trên thiết bị</strong> (AES-256-GCM) trước khi gửi lên máy chủ. Máy chủ chỉ thấy bản mã. Khóa giải mã <strong>không</strong> được gửi đi và <strong>không</strong> phụ thuộc vào tài khoản Google.</p>
      {s.hasKey ? <p><span className="badge good">Thiết bị này đã có khóa</span> phiên bản khóa {s.keyVersion}.</p> : <p><span className="badge warn">Chưa có khóa</span></p>}
      {!s.hasKey && <div className="grid g2">
        <div><h3>Thiết bị đầu tiên: tạo khóa</h3><p className="small muted">Tạo khóa ngẫu nhiên và một <em>khóa khôi phục</em> để bạn cất giữ.</p>
          <button className="btn primary" disabled={busy} onClick={() => void run(async () => { setShownKey(await syncController.enableEncryption()); setSaved(false); })}>Tạo khóa mã hóa</button></div>
        <div><h3>Thiết bị mới: nhập khóa khôi phục</h3><Field label="Khóa khôi phục"><input value={joinText} onChange={(e) => setJoinText(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" autoComplete="off" spellCheck={false} /></Field>
          <button className="btn" disabled={busy || !joinText.trim() || !s.email} onClick={() => void run(async () => { await syncController.joinWithRecoveryKey(joinText); setJoinText(''); }, 'Đã mở khóa thiết bị này')}>Thêm thiết bị này</button>{!s.email && <p className="small muted">Cần đăng nhập trước để lấy dữ liệu khóa (đã mã hóa) từ máy chủ.</p>}</div></div>}
      {s.hasKey && <div className="row"><button className="btn" disabled={busy} onClick={() => setConfirmRotate(true)}>Đổi khóa mã hóa…</button>{s.email && <button className="btn" disabled={busy} onClick={() => void run(async () => { await syncController.uploadEnvelopes(); }, 'Đã gửi envelope khóa (đã mã hóa) lên máy chủ')}>Gửi envelope khóa lên máy chủ</button>}<button className="btn" disabled={busy} onClick={() => void run(async () => { await syncController.finalizeRotation(); }, 'Đã xóa envelope khóa cũ')}>Hoàn tất đổi khóa</button></div>}
      <details className="small muted" style={{ marginTop: 8 }}><summary>Điều gì xảy ra nếu mất khóa?</summary><p><strong>Nếu mất toàn bộ thiết bị VÀ khóa khôi phục, dữ liệu đã mã hóa trên máy chủ và trong bản sao lưu không thể khôi phục</strong> — không ai (kể cả nhà phát triển, Supabase hay Google) mở được. Hãy cất khóa khôi phục ngoại tuyến (giấy, két, trình quản lý mật khẩu), tách khỏi điện thoại/máy tính.</p></details>
    </section>

    {conflicts.length > 0 && <section className="card" style={{ marginBottom: 12 }}><h2>Xung đột cần xử lý ({conflicts.length})</h2><p className="small muted">Cùng một bản ghi bị sửa ở hai nơi. Ứng dụng không tự ghi đè — hãy chọn bản đúng.</p>
      {conflicts.map((c) => { const l = c.local as Record<string, unknown>; const r = c.remote as Record<string, unknown>; const keys = [...new Set([...Object.keys(l), ...Object.keys(r)])].filter((k) => !['rev', 'updatedAt', 'createdAt'].includes(k) && JSON.stringify(l[k]) !== JSON.stringify(r[k]));
        return <div className="card" key={c.key} style={{ marginBottom: 8 }}><strong>{c.collection}</strong> <span className="small muted">{c.id}</span>
          <div className="table-wrap"><table><thead><tr><th>Trường</th><th>Bản trên máy này</th><th>Bản từ thiết bị khác</th></tr></thead><tbody>{keys.map((k) => <tr key={k}><td>{k}</td><td>{JSON.stringify(l[k])}</td><td>{JSON.stringify(r[k])}</td></tr>)}</tbody></table></div>
          <div className="row"><button className="btn small primary" onClick={() => void run(() => syncController.resolve(c.key, 'local'), 'Giữ bản trên máy này')}>Giữ bản trên máy này</button><button className="btn small" onClick={() => void run(() => syncController.resolve(c.key, 'remote'), 'Dùng bản từ thiết bị khác')}>Dùng bản từ thiết bị khác</button>{c.collection === 'transactions' && !(r as { deletedAt?: number }).deletedAt && <button className="btn small" onClick={() => void run(() => syncController.resolve(c.key, 'both'), 'Đã giữ cả hai')}>Giữ cả hai</button>}</div></div>; })}</section>}
    {conflicts.length === 0 && s.email && s.hasKey && <div className="card" style={{ marginBottom: 12 }}><Empty title="Không có xung đột" /></div>}

    <section className="card"><h2>2. Cách thêm iPhone</h2>
      <ol><li>Trên máy tính: đăng nhập Google, tạo khóa, lưu khóa khôi phục.</li><li>Trên iPhone: mở địa chỉ ứng dụng bằng Safari → Chia sẻ → “Thêm vào Màn hình chính”.</li><li>Mở ứng dụng từ biểu tượng, đăng nhập cùng tài khoản Google, nhập khóa khôi phục ở mục “Thiết bị mới”.</li><li>Bấm “Đồng bộ ngay” ở cả hai máy để kiểm tra.</li></ol>
      <p className="small muted">Chi tiết: <code>docs/IPHONE_PWA.md</code>, kiểm thử hai thiết bị: <code>docs/TEST_SYNC_TWO_DEVICES.md</code>.</p></section>

    {shownKey && <Modal title="Khóa khôi phục — lưu ngay bây giờ" onClose={() => { if (saved) setShownKey(null); }}>
      <Banner kind="warn"><strong>Khóa này chỉ hiện MỘT lần.</strong> Ứng dụng không lưu nó ở đâu cả. Mất khóa này và mất hết thiết bị = mất vĩnh viễn dữ liệu đã đồng bộ/sao lưu.</Banner>
      <div className="keybox" data-testid="recovery-key">{shownKey}</div>
      <div className="row" style={{ margin: '10px 0' }}><button className="btn" onClick={() => void navigator.clipboard?.writeText(shownKey)}>Sao chép</button><button className="btn" onClick={() => window.print()}>In</button></div>
      <label className="row"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Tôi đã lưu khóa khôi phục ở nơi an toàn, ngoài thiết bị này</label>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn primary" disabled={!saved} onClick={() => setShownKey(null)}>Tôi đã lưu — đóng</button></div></Modal>}
    {confirmRotate && <Confirm title="Đổi khóa mã hóa?" confirmLabel="Đổi khóa" onCancel={() => setConfirmRotate(false)} onConfirm={() => { setConfirmRotate(false); void run(async () => { setShownKey(await syncController.rotate()); setSaved(false); }); }}>
      <p>Tạo khóa dữ liệu mới + khóa khôi phục MỚI và mã hóa lại toàn bộ dữ liệu. Các thiết bị khác tự theo kịp khi đồng bộ. Sau khi mọi thiết bị đã đồng bộ, bấm “Hoàn tất đổi khóa” để khóa khôi phục cũ hết tác dụng.</p></Confirm>}
  </>;
}
