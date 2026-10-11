import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { syncController } from '../sync/controller';
import { todayIso } from '../domain/dates';

export const live = <T,>(rows: T[] | undefined, pred: (r: T) => boolean = () => true): T[] =>
  (rows ?? []).filter((r) => { const x = r as { deletedAt?: number | null; purged?: boolean }; return !x.deletedAt && !x.purged && pred(r); });

export function useLedger() {
  const data = useLiveQuery(async () => ({
    accounts: await db.accounts.toArray(), categories: await db.categories.toArray(), transactions: await db.transactions.toArray(), assets: await db.assets.toArray(),
    goals: await db.goals.toArray(), contributions: await db.contributions.toArray(), budgets: await db.budgets.toArray(), settings: await db.settings.get('settings-main'),
    importBatches: await db.importBatches.toArray(),
  }), []);
  const today = useToday();
  return useMemo(() => data ? {
    loading: false as const, today, settings: data.settings!,
    accounts: live(data.accounts).sort((a, b) => a.order - b.order), categories: live(data.categories).sort((a, b) => a.order - b.order),
    transactions: live(data.transactions), allTransactions: data.transactions, assets: live(data.assets), goals: live(data.goals).sort((a, b) => a.priority - b.priority),
    contributions: live(data.contributions), budgets: live(data.budgets), importBatches: live(data.importBatches),
    hasSample: data.accounts.some((a) => a.isSample && !a.deletedAt),
  } : { loading: true as const }, [data, today]);
}
export type Ledger = Extract<ReturnType<typeof useLedger>, { loading: false }>;

export function useToday(): string {
  const [d, setD] = useState(todayIso());
  useEffect(() => { const t = setInterval(() => setD(todayIso()), 60_000); return () => clearInterval(t); }, []);
  return d;
}
export const useSync = () => useSyncExternalStore(syncController.subscribe, syncController.getSnapshot);

export function useHashRoute(): [string, (r: string) => void] {
  const get = () => window.location.hash.replace(/^#\/?/, '') || 'tong-quan';
  const [r, setR] = useState(get);
  useEffect(() => { const h = () => setR(get()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return [r, (x) => { window.location.hash = `/${x}`; }];
}
