import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Ledger } from '../hooks';
import { BackupError, createLocalBackup, previewBackup, restoreBackup, type BackupPreview, type RestoreMode } from '../../io/backup';
import { connectDrive, disconnectDrive, DriveBackupClient, isDriveConfigured, isDriveConnected, type DriveFile } from '../../io/drive';
import { downloadBlob } from '../../io/exporter';
import { hasKeys } from '../../crypto/keystore';
import * as repo from '../../db/repo';
import { Banner, Confirm, Empty, Field, useAction } from '../components/common';

export function BackupPage({ L }: { L: Ledger }) {
  const backups = useLiveQuery(() => db.backups.orderBy('createdAt').reverse().toArray(), [], []);
  const keyed = useLiveQuery(() => hasKeys(), [], false);
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ text: string; source: string; preview: BackupPreview } | null>(null);
  const [mode, setMode] = useState<RestoreMode>('replace');
  const [recov, setRecov] = useState('');
  const [needKey, setNeedKey] = useState(false);
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [driveOn, setDriveOn] = useState(isDriveConnected());
  const [allowPlain, setAllowPlain] = useState(false);
  const drive = new DriveBackupClient();
  const last = backups.find((b) => b.ok);

  const download = (text: string, at: number) => downloadBlob(`gomke-finance-${new Date(at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.gomke-fin`, text, 'application/json');
  const stage = async (text: string, source: string) => { setPending({ text, source, preview: await previewBackup(text) }); setNeedKey(false); setRecov(''); };

  return <>
    <div className="topbar"><h1 className="grow">Sao lưu và khôi phục</h1><button className="btn primary" disabled={busy} onClick={() => void run(async () => { const b = await createLocalBackup('Thủ công'); if (b) download(b.data, b.createdAt); }, 'Đã sao lưu và tải tệp xuống')}>Sao lưu ngay</button></div>
    {!keyed && <Banner kind="warn" actions={<a className="btn small" href="#/dong-bo">Tạo khóa</a>}>Thiết bị chưa có khóa mã hóa nên bản sao lưu <strong>chưa được mã hóa</strong>. Hãy tạo khóa khôi phục để các bản sao lưu được mã hóa.</Banner>}
    <Banner kind="info"><strong>Giới hạn thật của sao lưu tự động:</strong> trình duyệt chỉ chạy được khi ứng dụng đang mở (kiểm tra mỗi giờ, sao lưu nếu đã quá 24 giờ). Nếu không mở ứng dụng, <strong>không có sao lưu nền</strong> nào chạy. Bản sao lưu cục bộ nằm cùng trình duyệt với dữ liệu — nếu xóa dữ liệu trình duyệt thì mất cả hai, nên hãy tải tệp về và/hoặc dùng Google Drive. Bản sao trên Supabase <strong>không phải</strong> bản sao lưu duy nhất của bạn.</Banner>
    <div className="grid g3"><div className="card stat"><div className="label">Bản tốt gần nhất</div><div className="value" style={{ fontSize: '1.05rem' }}>{last ? new Date(last.createdAt).toLocaleString('vi-VN') : 'Chưa có'}</div></div>
      <div className="card stat"><div className="label">Số bản giữ lại</div><div className="value">{backups.filter((b) => b.ok).length}/{L.settings.backupKeep}</div></div>
      <div className="card stat"><div className="label">Tự động hằng ngày (khi đang mở)</div><label className="row"><input type="checkbox" checked={L.settings.autoBackup} onChange={(e) => void run(() => repo.update('settings', 'settings-main', { autoBackup: e.target.checked }))} /> Bật</label></div></div>

    <section className="card" style={{ marginTop: 12 }}><h2>Các bản sao lưu trên thiết bị này</h2>
      {backups.length === 0 ? <Empty title="Chưa có bản sao lưu" /> : <div className="table-wrap"><table><thead><tr><th>Thời điểm</th><th>Kết quả</th><th>Mã hóa</th><th className="right">Kích thước</th><th>Ghi chú</th><th /></tr></thead><tbody>
        {backups.map((b) => <tr key={b.id}><td>{new Date(b.createdAt).toLocaleString('vi-VN')}</td><td>{b.ok ? <span className="badge good">Thành công, đã kiểm tra</span> : <span className="badge bad">Thất bại</span>}</td><td>{b.ok ? (b.encrypted ? 'Có' : 'Không') : '—'}</td><td className="right small">{b.ok ? `${Math.round(b.size / 1024)} KB` : '—'}</td><td className="small">{b.note}</td>
          <td className="nowrap">{b.ok && <><button className="btn small" onClick={() => download(b.data, b.createdAt)}>Tải xuống</button> <button className="btn small" onClick={() => void run(() => stage(b.data, `Bản ${new Date(b.createdAt).toLocaleString('vi-VN')}`))}>Khôi phục…</button></>}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="card" style={{ marginTop: 12 }}><h2>Khôi phục từ tệp</h2>
      <Field label="Chọn tệp sao lưu (.gomke-fin)"><input ref={fileRef} type="file" accept=".gomke-fin,application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void run(async () => stage(await f.text(), f.name)); }} /></Field>
      <p className="small muted">Chưa có gì thay đổi cho đến khi bạn xem thông tin bản sao lưu và xác nhận.</p></section>

    <section className="card" style={{ marginTop: 12 }}><h2>Google Drive (tùy chọn)</h2>
      {!isDriveConfigured() ? <p className="muted">Chưa cấu hình <code>VITE_GOOGLE_CLIENT_ID</code> nên chưa thể kết nối Drive. Xem <code>docs/BACKUP_RESTORE.md</code>.</p> : <>
        <p className="small muted">Chỉ xin quyền <code>drive.appdata</code> (thư mục ẩn riêng của ứng dụng, không đọc được tệp khác của bạn). Mặc định chỉ tải bản đã mã hóa; khóa giải mã không bao giờ được tải lên. Mỗi lần là một tệp mới, giữ 10 bản.</p>
        {!driveOn ? <button className="btn" disabled={busy} onClick={() => void run(async () => { await connectDrive(); setDriveOn(true); setDriveFiles(await drive.list()); }, 'Đã kết nối Drive')}>Kết nối Google Drive</button> : <div className="row">
          <button className="btn primary" disabled={busy} onClick={() => void run(async () => { const r = await drive.backupNow({ allowUnencrypted: allowPlain }); setDriveFiles(await drive.list()); return r; }, 'Đã sao lưu lên Drive và kiểm tra toàn vẹn')}>Sao lưu lên Drive</button>
          <button className="btn" onClick={() => void run(async () => setDriveFiles(await drive.list()))}>Làm mới danh sách</button><button className="btn" onClick={() => { disconnectDrive(); setDriveOn(false); setDriveFiles(null); }}>Ngắt kết nối</button>
          {!keyed && <label className="row small"><input type="checkbox" checked={allowPlain} onChange={(e) => setAllowPlain(e.target.checked)} /> Cho phép tải bản CHƯA mã hóa (không khuyến nghị)</label>}</div>}
        {driveFiles && (driveFiles.length === 0 ? <Empty title="Chưa có bản sao lưu trên Drive" /> : <div className="table-wrap"><table><tbody>{driveFiles.map((f) => <tr key={f.id}><td>{new Date(f.createdTime).toLocaleString('vi-VN')}</td><td className="small">{f.name}</td><td>{f.appProperties?.encrypted === 'true' ? 'Mã hóa' : 'Không mã hóa'}</td><td><button className="btn small" onClick={() => void run(async () => stage(await drive.fetchForRestore(f.id).catch(async (e) => { if (e instanceof BackupError && e.code === 'key') { return drive.download(f.id); } throw e; }), `Drive: ${f.name}`))}>Khôi phục…</button></td></tr>)}</tbody></table></div>)}</>}
      {!driveOn && isDriveConfigured() && <p className="small muted">Chưa kết nối — sẽ không có gì được gửi lên Drive.</p>}</section>

    {pending && <Confirm title="Xác nhận khôi phục" confirmLabel={mode === 'replace' ? 'Thay thế dữ liệu hiện tại' : 'Gộp vào dữ liệu hiện tại'} danger={mode === 'replace'} onCancel={() => setPending(null)} onConfirm={() => void run(async () => {
      try { const r = await restoreBackup(pending.text, mode, { recoveryKey: recov || undefined }); setPending(null); return r; }
      catch (e) { if (e instanceof BackupError && e.code === 'key') setNeedKey(true); throw e; }
    }, 'Đã khôi phục')}>
      <p>Nguồn: <strong>{pending.source}</strong></p>
      <ul><li>Tạo lúc: <strong>{new Date(pending.preview.createdAt).toLocaleString('vi-VN')}</strong></li><li>{pending.preview.encrypted ? 'Đã mã hóa' : 'Chưa mã hóa'}</li><li>Giao dịch: {pending.preview.counts.transactions ?? 0} · Tài khoản: {pending.preview.counts.accounts ?? 0} · Mục tiêu: {pending.preview.counts.goals ?? 0} · Tài sản: {pending.preview.counts.assets ?? 0}</li></ul>
      {pending.preview.olderThanLocalByDays !== null && <Banner kind="warn"><strong>Bản sao lưu CŨ HƠN dữ liệu hiện tại khoảng {pending.preview.olderThanLocalByDays} ngày.</strong> Chọn “Thay thế” sẽ đưa các thay đổi mới hơn vào thùng rác.</Banner>}
      <Field label="Cách khôi phục"><select value={mode} onChange={(e) => setMode(e.target.value as RestoreMode)}><option value="replace">Thay thế: đưa dữ liệu về đúng bản sao lưu (phần mới hơn vào thùng rác)</option><option value="merge">Gộp: chỉ thêm bản ghi chưa có, không nhân đôi giao dịch</option></select></Field>
      {(needKey || pending.preview.encrypted) && <Field label="Khóa khôi phục (chỉ cần nếu máy này chưa có khóa phù hợp)"><input value={recov} onChange={(e) => setRecov(e.target.value)} autoComplete="off" spellCheck={false} /></Field>}
      <p className="small muted">Ứng dụng tự tạo một bản sao lưu an toàn của dữ liệu hiện tại trước khi khôi phục.</p></Confirm>}
  </>;
}
