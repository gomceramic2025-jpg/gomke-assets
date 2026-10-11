import { FinanceDB, setDatabase, db } from '../../src/db/db';
import { SyncEngine } from '../../src/sync/engine';
import type { FakeServer } from './fakeServer';

let counter = 0;
export interface Device { name: string; db: FinanceDB; engine: SyncEngine; on: <T>(fn: () => Promise<T>) => Promise<T> }

export function makeDevice(name: string, server: FakeServer): Device {
  const d = new FinanceDB(`test-${name}-${++counter}-${Math.random().toString(36).slice(2)}`);
  const engine = new SyncEngine(server.transport(name), { id: `device-${name}`, name });
  return {
    name, db: d, engine,
    on: async (fn) => { const prev = db; setDatabase(d); try { return await fn(); } finally { setDatabase(prev); } },
  };
}
