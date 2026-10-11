import type { SyncCollection } from '../domain/schemas';
import type { StoredEnvelope } from '../crypto/keystore';

export interface RemoteRecord {
  collection: SyncCollection; recordId: string; rev: number; seq: number; deleted: boolean;
  keyVersion: number; payload: string; deviceId?: string;
}
export interface PushOp { collection: SyncCollection; recordId: string; opId: string; baseRev: number; deleted: boolean; keyVersion: number; payload: string }
export interface PushResult { status: 'ok' | 'conflict'; duplicate: boolean; rev: number; seq: number; record: RemoteRecord | null }

export type TransportErrorKind = 'network' | 'auth' | 'forbidden' | 'server';
export class TransportError extends Error {
  constructor(readonly kind: TransportErrorKind, message: string) { super(message); this.name = 'TransportError'; }
}

/** Giao diện máy chủ đồng bộ. Cài đặt thật: SupabaseTransport. Bản thử nghiệm: FakeServer (tests). */
export interface SyncTransport {
  push(op: PushOp): Promise<PushResult>;
  pull(afterSeq: number, limit: number): Promise<RemoteRecord[]>;
  getEnvelopes(): Promise<StoredEnvelope[]>;
  putEnvelopes(envs: StoredEnvelope[]): Promise<void>;
  deleteEnvelopesBelow(kv: number): Promise<void>;
  touchDevice(deviceId: string, name: string): Promise<void>;
}

export type SyncStatus = 'idle-local' | 'synced' | 'syncing' | 'offline' | 'failed' | 'conflict' | 'auth' | 'no-key';
