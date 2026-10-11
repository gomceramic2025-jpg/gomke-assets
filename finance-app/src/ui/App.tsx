import { useEffect, useState, type ReactNode } from 'react';
import { ensureDefaults } from '../db/seed';
import { runAutoBackupIfDue } from '../io/backup';
import { REQUIRE_LOGIN, syncController, STATUS_LABEL } from '../sync/controller';
import { ToastProvider, Loading } from './components/common';
import { useHashRoute, useLedger, useSync } from './hooks';
import { Dashboard } from './pages/Dashboard';
import { Transactions } from './pages/Transactions';
import { ImportPage } from './pages/Import';
import { Budgets } from './pages/Budgets';
import { Goals } from './pages/Goals';
import { Assets } from './pages/Assets';
import { Reports } from './pages/Reports';
import { SyncPage } from './pages/Sync';
import { BackupPage } from './pages/Backup';
import { SettingsPage } from './pages/Settings';
import { Assistant } from './pages/Assistant';
import { LoginPage } from './pages/Login';

const ROUTES: Array<{ id: string; label: string; icon: string; short?: string }> = [
  { id: 'tong-quan', label: 'Tổng quan', icon: '▦' }, { id: 'giao-dich', label: 'Giao dịch', icon: '☰' }, { id: 'nhap-sao-ke', label: 'Nhập sao kê', icon: '⇪', short: 'Nhập' },
  { id: 'ngan-sach', label: 'Ngân sách', icon: '◔' }, { id: 'muc-tieu', label: 'Mục tiêu tiết kiệm', icon: '◎', short: 'Mục tiêu' }, { id: 'tai-san', label: 'Tài sản', icon: '◆' },
  { id: 'bao-cao', label: 'Báo cáo', icon: '▤' }, { id: 'dong-bo', label: 'Đồng bộ thiết bị', icon: '⇄', short: 'Đồng bộ' }, { id: 'sao-luu', label: 'Sao lưu và khôi phục', icon: '⤓', short: 'Sao lưu' },
  { id: 'cai-dat', label: 'Cài đặt', icon: '⚙' }, { id: 'tro-ly', label: 'Trợ lý AI', icon: '✦', short: 'Trợ lý' }, { id: 'dang-nhap', label: 'Đăng nhập', icon: '☺' },
];
const MOBILE_MAIN = ['tong-quan', 'giao-dich', 'ngan-sach', 'muc-tieu'];

export function App() {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        await ensureDefaults();
        setReady(true);
        void syncController.start();
        void runAutoBackupIfDue();
        const t = setInterval(() => void runAutoBackupIfDue(), 3600_000);
        return () => clearInterval(t);
      } catch (e) { setFatal(e instanceof Error ? e.message : String(e)); }
    })();
  }, []);
  if (fatal) return <div className="empty"><h1>Không mở được cơ sở dữ liệu cục bộ</h1><p>{fatal}</p><p className="muted">Trình duyệt có thể đang chặn lưu trữ (chế độ riêng tư) hoặc hết dung lượng. Hãy mở bằng cửa sổ thường.</p></div>;
  if (!ready) return <Loading />;
  return <ToastProvider><Shell /></ToastProvider>;
}

function Shell() {
  const [route, go] = useHashRoute();
  const [more, setMore] = useState(false);
  const sync = useSync();
  const L = useLedger();
  useEffect(() => { setMore(false); window.scrollTo(0, 0); }, [route]);

  if (REQUIRE_LOGIN && sync.configured && sync.sessionChecked && !sync.email) return <main><LoginPage gate /></main>;
  if (L.loading) return <Loading />;

  const page: Record<string, ReactNode> = {
    'tong-quan': <Dashboard L={L} go={go} />, 'giao-dich': <Transactions L={L} />, 'nhap-sao-ke': <ImportPage L={L} />, 'ngan-sach': <Budgets L={L} />,
    'muc-tieu': <Goals L={L} />, 'tai-san': <Assets L={L} />, 'bao-cao': <Reports L={L} />, 'dong-bo': <SyncPage L={L} />, 'sao-luu': <BackupPage L={L} />,
    'cai-dat': <SettingsPage L={L} />, 'tro-ly': <Assistant L={L} />, 'dang-nhap': <LoginPage />,
  };
  const cur = ROUTES.some((r) => r.id === route) ? route : 'tong-quan';
  const statusTone = sync.status === 'synced' ? 'good' : sync.status === 'conflict' || sync.status === 'failed' || sync.status === 'auth' ? 'bad' : sync.status === 'syncing' || sync.status === 'offline' ? 'warn' : '';
  return <div className="shell">
    <nav className="nav" aria-label="Điều hướng chính">
      <div className="brand">Gốm Kể · Tài chính<small>Cá nhân · chạy trên máy bạn</small></div>
      {ROUTES.map((r) => <a key={r.id} href={`#/${r.id}`} aria-current={cur === r.id ? 'page' : undefined}><span aria-hidden>{r.icon}</span>{r.label}
        {r.id === 'dong-bo' && (sync.conflicts > 0 ? <span className="badge bad">{sync.conflicts}</span> : sync.pending > 0 && sync.configured ? <span className="badge warn">{sync.pending}</span> : null)}</a>)}
      <p className="small muted" style={{ padding: '10px' }}>Đồng bộ: <span className={`badge ${statusTone}`}>{STATUS_LABEL[sync.status]}</span></p>
    </nav>
    <main id="main" tabIndex={-1}>
      {page[cur]}
    </main>
    {more && <div className="more-sheet" role="menu" aria-label="Thêm">{ROUTES.filter((r) => !MOBILE_MAIN.includes(r.id)).map((r) => <a key={r.id} href={`#/${r.id}`} aria-current={cur === r.id ? 'page' : undefined}>{r.icon} {r.label}</a>)}</div>}
    <nav className="bottom-nav" aria-label="Điều hướng nhanh">
      {ROUTES.filter((r) => MOBILE_MAIN.includes(r.id)).map((r) => <a key={r.id} href={`#/${r.id}`} aria-current={cur === r.id ? 'page' : undefined}><span className="ico" aria-hidden>{r.icon}</span>{r.short ?? r.label}</a>)}
      <button onClick={() => setMore((m) => !m)} aria-expanded={more}><span className="ico" aria-hidden>⋯</span>Thêm</button>
    </nav>
  </div>;
}
