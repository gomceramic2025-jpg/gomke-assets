import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { TransportError, type PushOp, type PushResult, type RemoteRecord, type SyncTransport } from './types';
import type { StoredEnvelope } from '../crypto/keystore';
import type { SyncCollection } from '../domain/schemas';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const OWNER_EMAIL_HINT = ((import.meta.env.VITE_OWNER_EMAIL as string | undefined) ?? '').trim().toLowerCase();
export const REQUIRE_LOGIN = import.meta.env.VITE_REQUIRE_LOGIN === 'true';

export const isSupabaseConfigured = (): boolean => Boolean(url && anon && /^https:\/\//.test(url));

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  client ??= createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  return client;
}

export async function signInWithGoogle(): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Chưa cấu hình Supabase');
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: 'select_account' } } });
  if (error) throw error;
}
export async function signOut(): Promise<void> { await getSupabase()?.auth.signOut(); }
export async function currentSession(): Promise<Session | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

interface PgErr { code?: string; message?: string; status?: number }
function mapError(e: PgErr | null | undefined): TransportError {
  const msg = e?.message ?? 'Lỗi máy chủ';
  if (e?.code === '42501' || e?.status === 403 || /not_owner/.test(msg)) return new TransportError('forbidden', 'Tài khoản này không được phép truy cập dữ liệu đồng bộ');
  if (e?.status === 401 || e?.code === 'PGRST301' || /jwt|token|expired/i.test(msg)) return new TransportError('auth', 'Phiên đăng nhập đã hết hạn — hãy đăng nhập lại');
  if (!e?.status && /fetch|network|failed to|timeout|offline/i.test(msg)) return new TransportError('network', 'Không kết nối được máy chủ');
  return new TransportError('server', msg);
}
const wrap = async <T>(fn: () => PromiseLike<{ data: T | null; error: PgErr | null }>): Promise<T | null> => {
  let res;
  try { res = await fn(); } catch (e) { throw new TransportError('network', e instanceof Error ? e.message : 'Không kết nối được máy chủ'); }
  if (res.error) throw mapError(res.error);
  return res.data;
};

type Row = { collection: SyncCollection; record_id: string; rev: number; seq: number; deleted: boolean; key_version: number; payload: string; device_id?: string };
const toRemote = (r: Row): RemoteRecord => ({ collection: r.collection, recordId: r.record_id, rev: r.rev, seq: Number(r.seq), deleted: r.deleted, keyVersion: r.key_version, payload: r.payload, deviceId: r.device_id });

export class SupabaseTransport implements SyncTransport {
  constructor(private sb: SupabaseClient) {}
  private async uid(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    if (!data.session) throw new TransportError('auth', 'Chưa đăng nhập');
    return data.session.user.id;
  }
  async push(op: PushOp): Promise<PushResult> {
    const d = await wrap(() => this.sb.rpc('push_record', {
      p_collection: op.collection, p_record_id: op.recordId, p_op_id: op.opId, p_base_rev: op.baseRev,
      p_deleted: op.deleted, p_key_version: op.keyVersion, p_payload: op.payload, p_device_id: deviceIdForTransport,
    }));
    const r = d as { status: 'ok' | 'conflict'; duplicate: boolean; rev: number; seq: number; record: Row | null } | null;
    if (!r) throw new TransportError('server', 'Máy chủ không trả kết quả');
    return { status: r.status, duplicate: r.duplicate, rev: r.rev, seq: Number(r.seq), record: r.record ? toRemote(r.record) : null };
  }
  async pull(afterSeq: number, limit: number): Promise<RemoteRecord[]> {
    const rows = await wrap(() => this.sb.from('sync_records').select('collection,record_id,rev,seq,deleted,key_version,payload,device_id').gt('seq', afterSeq).order('seq', { ascending: true }).limit(limit));
    return ((rows ?? []) as Row[]).map(toRemote);
  }
  async getEnvelopes(): Promise<StoredEnvelope[]> {
    const rows = await wrap(() => this.sb.from('key_envelopes').select('key_version,kind,envelope'));
    return ((rows ?? []) as Array<{ key_version: number; kind: 'recovery' | 'chain'; envelope: StoredEnvelope['envelope'] }>).map((r) => ({ kv: r.key_version, kind: r.kind, envelope: r.envelope }));
  }
  async putEnvelopes(envs: StoredEnvelope[]): Promise<void> {
    const uid = await this.uid();
    await wrap(() => this.sb.from('key_envelopes').upsert(envs.map((e) => ({ user_id: uid, key_version: e.kv, kind: e.kind, envelope: e.envelope, updated_at: new Date().toISOString() }))));
  }
  async deleteEnvelopesBelow(kv: number): Promise<void> {
    await wrap(() => this.sb.from('key_envelopes').delete().lt('key_version', kv));
    await wrap(() => this.sb.from('key_envelopes').delete().eq('key_version', kv).eq('kind', 'chain'));
  }
  async touchDevice(deviceId: string, name: string): Promise<void> {
    deviceIdForTransport = deviceId;
    const uid = await this.uid();
    await wrap(() => this.sb.from('devices').upsert({ user_id: uid, device_id: deviceId, name, last_seen: new Date().toISOString() }));
  }
}
let deviceIdForTransport = 'unknown';
