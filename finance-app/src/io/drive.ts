/**
 * Sao lưu Google Drive (tùy chọn).
 *  - Chỉ xin scope tối thiểu: drive.appdata (thư mục ẩn riêng của ứng dụng; không thấy/đọc được tệp khác trong Drive của bạn).
 *  - Token chỉ giữ trong bộ nhớ trang (hết hạn ~1 giờ), không lưu xuống đĩa.
 *  - Mặc định chỉ tải bản ĐÃ MÃ HÓA. Khóa giải mã không bao giờ được tải lên.
 *  - Mỗi lần sao lưu là một tệp mới (không ghi đè); chỉ dọn bản cũ sau khi bản mới đã được tải về kiểm tra khớp.
 */
import { buildBackup, readBackup, BackupError } from './backup';
import { sha256Hex } from '../crypto/crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com';
export const googleClientId = (): string => ((import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '').trim();
export const isDriveConfigured = (): boolean => googleClientId().length > 0;

export class DriveError extends Error {
  constructor(message: string, readonly code: 'not-connected' | 'not-configured' | 'http' | 'integrity' | 'unencrypted' | 'denied' | 'network') { super(message); this.name = 'DriveError'; }
}

export interface DriveFile { id: string; name: string; createdTime: string; size?: string; appProperties?: { checksum?: string; createdAt?: string; encrypted?: string } }

declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient(c: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string; expires_in?: number }) => void; error_callback?: (e: { type: string }) => void }): { requestAccessToken(o?: { prompt?: string }): void } } } } }
}

let token: { value: string; expiresAt: number } | null = null;
export const isDriveConnected = (now = Date.now()): boolean => !!token && token.expiresAt > now;
export function disconnectDrive(): void { token = null; }

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new DriveError('Không tải được thư viện đăng nhập Google (kiểm tra mạng)', 'network'));
    document.head.appendChild(s);
  });
}

/** Chỉ gọi khi người dùng bấm "Kết nối Google Drive" (cần thao tác người dùng để trình duyệt cho mở cửa sổ cấp quyền). */
export async function connectDrive(): Promise<void> {
  if (!isDriveConfigured()) throw new DriveError('Chưa cấu hình VITE_GOOGLE_CLIENT_ID', 'not-configured');
  await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: googleClientId(), scope: DRIVE_SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new DriveError('Bạn đã từ chối hoặc không cấp quyền Drive', 'denied'));
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3000) * 1000 - 30_000 };
        resolve();
      },
      error_callback: () => reject(new DriveError('Không mở được cửa sổ cấp quyền Google', 'denied')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export class DriveBackupClient {
  constructor(private getToken: () => string | null = () => (isDriveConnected() ? token!.value : null), private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    const t = this.getToken();
    if (!t) throw new DriveError('Chưa kết nối Google Drive (hoặc phiên đã hết hạn)', 'not-connected');
    let res: Response;
    try { res = await this.fetchImpl(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } }); }
    catch { throw new DriveError('Không kết nối được Google Drive', 'network'); }
    if (res.status === 401) { token = null; throw new DriveError('Phiên Google Drive đã hết hạn — hãy kết nối lại', 'not-connected'); }
    if (!res.ok) throw new DriveError(`Google Drive trả lỗi ${res.status}`, 'http');
    return res;
  }

  async list(): Promise<DriveFile[]> {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'files(id,name,createdTime,size,appProperties)', orderBy: 'createdTime desc', pageSize: '100' });
    return ((await (await this.req(`/drive/v3/files?${q}`)).json()) as { files: DriveFile[] }).files ?? [];
  }

  async download(id: string): Promise<string> { return (await this.req(`/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).text(); }

  async remove(id: string): Promise<void> { await this.req(`/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

  /** Tải lên bản sao lưu MỚI, tải về đối chiếu hash, rồi mới dọn bản cũ (giữ `keep` bản). */
  async backupNow(opts: { allowUnencrypted?: boolean; keep?: number; now?: number } = {}): Promise<{ file: DriveFile; verified: true; pruned: number }> {
    const { text, file } = await buildBackup({ now: opts.now });
    if (!file.encrypted && !opts.allowUnencrypted) throw new DriveError('Thiết bị chưa có khóa mã hóa nên bản sao lưu sẽ không được mã hóa. Hãy tạo khóa khôi phục trước, hoặc chọn rõ ràng cho phép tải bản chưa mã hóa.', 'unencrypted');
    const name = `gomke-finance-${new Date(file.createdAt).toISOString().replace(/[:.]/g, '-')}.gomke-fin`;
    const boundary = 'gk' + Math.random().toString(36).slice(2);
    const meta = { name, parents: ['appDataFolder'], mimeType: 'application/json', appProperties: { checksum: file.checksum, createdAt: String(file.createdAt), encrypted: String(file.encrypted) } };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
    const created = (await (await this.req('/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size,appProperties', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json()) as DriveFile;
    const back = await this.download(created.id);
    if ((await sha256Hex(back)) !== (await sha256Hex(text))) {
      await this.remove(created.id).catch(() => undefined);
      throw new DriveError('Kiểm tra toàn vẹn thất bại: bản tải lên không khớp bản gốc. Bản lỗi đã bị xóa, các bản cũ được giữ nguyên.', 'integrity');
    }
    const keep = opts.keep ?? 10;
    const all = await this.list();
    const old = all.filter((f) => f.id !== created.id).slice(Math.max(0, keep - 1));
    for (const f of old) await this.remove(f.id);
    return { file: created, verified: true, pruned: old.length };
  }

  /** Tải một bản về và kiểm tra (chưa áp dụng). Trả về nội dung tệp để đưa vào quy trình khôi phục thông thường. */
  async fetchForRestore(id: string, opts: { recoveryKey?: string } = {}): Promise<string> {
    const text = await this.download(id);
    try { await readBackup(text, opts); } catch (e) { if (e instanceof BackupError) throw e; throw new DriveError('Bản sao lưu trên Drive không đọc được', 'integrity'); }
    return text;
  }
}
