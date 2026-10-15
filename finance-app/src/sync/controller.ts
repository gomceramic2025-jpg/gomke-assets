/** Điều phối đồng bộ trong trình duyệt: trạng thái cho giao diện, lịch thử lại, quản lý khóa. */
import { liveQuery } from 'dexie';
import { db, kvGet, kvSet } from '../db/db';
import { randomId } from '../crypto/crypto';
import { createKeys, followChains, hasKeys, pruneOldEnvelopes, rotateKeys, unlockWithRecoveryKey, listEnvelopes, latestKeyVersion } from '../crypto/keystore';
import { SyncEngine, retryDelaySec, type SyncReport } from './engine';
import { OWNER_EMAIL_HINT, REQUIRE_LOGIN, SupabaseTransport, getSupabase, isSupabaseConfigured, signInWithGoogle, signOut } from './supabase';
import type { SyncStatus } from './types';

export type UiSyncStatus = SyncStatus | 'unconfigured' | 'signed-out';
export interface SyncState {
  status: UiSyncStatus; configured: boolean; email: string | null; hasKey: boolean; keyVersion: number;
  pending: number; conflicts: number; lastSyncedAt: number | null; error: string | null; denied: string | null; online: boolean; sessionChecked: boolean;
}

export const STATUS_LABEL: Record<UiSyncStatus, string> = {
  'unconfigured': 'Chưa cấu hình đồng bộ', 'signed-out': 'Chưa đăng nhập', 'no-key': 'Chưa có khóa mã hóa', 'idle-local': 'Chỉ lưu trên máy này',
  synced: 'Đã đồng bộ', syncing: 'Đang đồng bộ', offline: 'Chờ kết nối', failed: 'Đồng bộ thất bại', conflict: 'Có xung đột cần xử lý', auth: 'Cần đăng nhập lại',
};

class Controller {
  state: SyncState = { status: isSupabaseConfigured() ? 'signed-out' : 'unconfigured', configured: isSupabaseConfigured(), email: null, hasKey: false, keyVersion: 0, pending: 0, conflicts: 0, lastSyncedAt: null, error: null, denied: null, online: typeof navigator === 'undefined' ? true : navigator.onLine, sessionChecked: !isSupabaseConfigured() };
  private listeners = new Set<() => void>();
  private engine: SyncEngine | null = null;
  private transport: SupabaseTransport | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private started = false;
  private lastPending = 0;

  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getSnapshot = () => this.state;
  private set(p: Partial<SyncState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }

  async start(): Promise<void> {
    if (this.started) return; this.started = true;
    await this.refreshLocal();
    liveQuery(() => db.outbox.count()).subscribe({ next: (n) => { this.set({ pending: n }); if (n > this.lastPending) this.schedule(2000); this.lastPending = n; }, error: () => undefined });
    liveQuery(() => db.conflicts.count()).subscribe({ next: (n) => this.set({ conflicts: n }), error: () => undefined });
    window.addEventListener('online', () => { this.set({ online: true }); this.schedule(500); });
    window.addEventListener('offline', () => this.set({ online: false }));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.schedule(500); });
    setInterval(() => this.schedule(0), 60_000);
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.auth.getSession();
    await this.onSession(data.session?.user.email ?? null);
    sb.auth.onAuthStateChange((_e, s) => { void this.onSession(s?.user.email ?? null); });
  }

  private async refreshLocal() {
    const hk = await hasKeys();
    this.set({ hasKey: hk, keyVersion: await latestKeyVersion(), lastSyncedAt: (await kvGet<number>('lastSyncedAt')) ?? null });
  }

  private async onSession(email: string | null) {
    if (email && OWNER_EMAIL_HINT && email.toLowerCase() !== OWNER_EMAIL_HINT) {
      await signOut();
      this.set({ email: null, status: 'signed-out', denied: `Tài khoản ${email} không phải chủ sở hữu được cấu hình. Đã đăng xuất. (Quyền thật được kiểm tra ở máy chủ.)`, sessionChecked: true });
      return;
    }
    this.set({ email, denied: null, sessionChecked: true, status: email ? (this.state.hasKey ? 'syncing' : 'no-key') : 'signed-out' });
    if (email) {
      const sb = getSupabase()!;
      this.transport = new SupabaseTransport(sb);
      let id = await kvGet<string>('deviceId');
      if (!id) { id = randomId(); await kvSet('deviceId', id); }
      this.engine = new SyncEngine(this.transport, { id, name: deviceName() });
      this.schedule(100);
    } else { this.engine = null; this.transport = null; }
  }

  schedule(ms: number) {
    if (!this.engine || !this.state.hasKey) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  async syncNow(): Promise<SyncReport | null> {
    await this.refreshLocal();
    if (!this.engine) return null;
    if (!this.state.hasKey) { this.set({ status: 'no-key' }); return null; }
    if (!navigator.onLine) { this.set({ status: 'offline', online: false }); return null; }
    this.set({ status: 'syncing', error: null });
    const r = await this.engine.syncOnce();
    this.set({ status: r.status, error: r.errors[0] ?? null, conflicts: r.conflicts, lastSyncedAt: r.status === 'synced' ? r.finishedAt : this.state.lastSyncedAt });
    if (r.status === 'offline' || r.status === 'failed') { this.attempts++; this.schedule(retryDelaySec(this.attempts) * 1000); }
    else if (r.status === 'syncing') this.schedule(500);
    else this.attempts = 0;
    return r;
  }

  async resolve(key: string, choice: 'local' | 'remote' | 'both') { await this.engine?.resolveConflict(key, choice); this.schedule(200); }

  signIn = signInWithGoogle;
  async signOutNow() { await signOut(); this.engine = null; this.set({ email: null, status: 'signed-out' }); }

  // ---- khóa ----
  /** 'create' = chưa ai tạo khóa; 'join' = máy chủ đã có khóa → phải nhập khóa khôi phục; 'ready' = máy này đã có khóa */
  async keyPlan(): Promise<'create' | 'join' | 'ready'> {
    if (await hasKeys()) return 'ready';
    if (this.transport) { const env = await this.transport.getEnvelopes(); if (env.length) return 'join'; }
    return 'create';
  }
  async enableEncryption(): Promise<string> {
    if ((await this.keyPlan()) === 'join') throw new Error('Tài khoản này đã có khóa mã hóa trên máy chủ. Hãy chọn "Thêm thiết bị bằng khóa khôi phục" để không tạo ra hai bộ khóa khác nhau.');
    const k = await createKeys();
    if (this.transport) await this.transport.putEnvelopes(k.envelopes);
    await this.refreshLocal(); this.schedule(300);
    return k.recoveryKey;
  }
  /** Gọi sau khi đăng nhập nếu khóa được tạo khi chưa đăng nhập: đưa envelope (đã mã hóa) lên máy chủ. */
  async uploadEnvelopes() { if (this.transport && (await hasKeys())) await this.transport.putEnvelopes(await listEnvelopes()); }
  async joinWithRecoveryKey(text: string) {
    if (!this.transport) throw new Error('Cần đăng nhập Google trước');
    await unlockWithRecoveryKey(text, await this.transport.getEnvelopes());
    await this.refreshLocal(); this.schedule(100);
  }
  async rotate(): Promise<string> {
    const r = await rotateKeys();
    if (this.transport) await this.transport.putEnvelopes(r.envelopes);
    await this.engine?.reencryptAll();
    await this.refreshLocal(); this.schedule(100);
    return r.recoveryKey;
  }
  async finalizeRotation() {
    const kv = await latestKeyVersion();
    await this.transport?.deleteEnvelopesBelow(kv);
    await pruneOldEnvelopes(kv);
  }
  async followKeyChain() { if (this.transport) await followChains(await this.transport.getEnvelopes()); }
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Thiết bị';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return `${os} ${br}`.trim();
}

export const syncController = new Controller();
export { REQUIRE_LOGIN };
