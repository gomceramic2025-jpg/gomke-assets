/** Máy chủ giả lập cùng quy tắc với migration SQL (đã kiểm chứng riêng bằng PGlite trong sql.test.ts). */
import { TransportError, type PushOp, type PushResult, type RemoteRecord, type SyncTransport } from '../../src/sync/types';
import type { StoredEnvelope } from '../../src/crypto/keystore';

export class FakeServer {
  rows = new Map<string, RemoteRecord & { lastOp: string }>();
  ops = new Map<string, { rev: number; seq: number }>();
  envelopes: StoredEnvelope[] = [];
  seq = 0;
  pushLog: PushOp[] = [];
  /** điều khiển lỗi */
  offline = false;
  authExpired = false;
  forbidden = false;
  serverError = false;
  /** mô phỏng "đã ghi nhưng mất phản hồi" */
  dropResponseOnce = false;

  private guard() {
    if (this.offline) throw new TransportError('network', 'Không kết nối được máy chủ');
    if (this.authExpired) throw new TransportError('auth', 'Phiên đăng nhập đã hết hạn');
    if (this.forbidden) throw new TransportError('forbidden', 'Không được phép');
    if (this.serverError) throw new TransportError('server', 'Lỗi máy chủ 500');
  }
  /** toàn bộ dữ liệu máy chủ nhìn thấy, để kiểm tra không có bản rõ */
  dump(): string { return JSON.stringify([...this.rows.values()]) + JSON.stringify(this.envelopes); }

  transport(deviceId: string): SyncTransport {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const s = this;
    return {
      async push(op: PushOp): Promise<PushResult> {
        s.guard();
        s.pushLog.push(op);
        const dup = s.ops.get(op.opId);
        const key = `${op.collection}:${op.recordId}`;
        const cur = s.rows.get(key);
        if (dup) return { status: 'ok', duplicate: true, rev: dup.rev, seq: dup.seq, record: cur ?? null };
        if (cur && cur.rev !== op.baseRev) return { status: 'conflict', duplicate: false, rev: cur.rev, seq: cur.seq, record: cur };
        if (!cur && op.baseRev !== 0) return { status: 'conflict', duplicate: false, rev: 0, seq: 0, record: null };
        const rev = (cur?.rev ?? 0) + 1;
        const seq = ++s.seq;
        const rec = { collection: op.collection, recordId: op.recordId, rev, seq, deleted: op.deleted, keyVersion: op.keyVersion, payload: op.payload, deviceId, lastOp: op.opId };
        s.rows.set(key, rec);
        s.ops.set(op.opId, { rev, seq });
        if (s.dropResponseOnce) { s.dropResponseOnce = false; throw new TransportError('network', 'Mất kết nối khi chờ phản hồi'); }
        return { status: 'ok', duplicate: false, rev, seq, record: rec };
      },
      async pull(after: number, limit: number) {
        s.guard();
        return [...s.rows.values()].filter((r) => r.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
      },
      async getEnvelopes() { s.guard(); return s.envelopes.map((e) => JSON.parse(JSON.stringify(e)) as StoredEnvelope); },
      async putEnvelopes(envs) {
        s.guard();
        for (const e of envs) { s.envelopes = s.envelopes.filter((x) => !(x.kv === e.kv && x.kind === e.kind)); s.envelopes.push(JSON.parse(JSON.stringify(e))); }
      },
      async deleteEnvelopesBelow(kv) { s.guard(); s.envelopes = s.envelopes.filter((e) => e.kv >= kv && !(e.kv === kv && e.kind === 'chain')); },
      async touchDevice() { s.guard(); },
    };
  }
}
