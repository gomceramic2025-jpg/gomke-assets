import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatVnd, parseVndAmount } from '../../domain/money';

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'pos' | 'neg' }) {
  return <div className="card stat"><div className="label">{label}</div><div className={`value num ${tone ?? ''}`}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
export const Money = ({ v, signed }: { v: number; signed?: boolean }) => <span className={`num ${signed ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : ''}`}>{signed && v > 0 ? '+' : ''}{formatVnd(v)}</span>;

export function Banner({ kind, children, actions }: { kind: 'info' | 'warn' | 'error' | 'success' | 'sample'; children: ReactNode; actions?: ReactNode }) {
  return <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : 'status'}><div>{children}</div>{actions}</div>;
}
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => <div className="empty"><p><strong>{title}</strong></p>{children}</div>;
export const Loading = () => <div className="empty" role="status" aria-live="polite">Đang tải dữ liệu…</div>;

export function Progress({ pct, tone }: { pct: number; tone?: 'over' | 'warn' }) {
  const p = Math.max(0, Math.min(100, pct));
  return <div className={`progress ${tone ?? ''}`} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${p}%` }} /></div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  return <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="row" style={{ justifyContent: 'space-between' }}><h2>{title}</h2><button className="btn small" onClick={onClose} aria-label="Đóng">✕</button></div>
      {children}
    </div></div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <span className="small muted">{hint}</span>}</label>;
}

/** Ô nhập tiền: gõ tự do (1.000.000 / 1,000,000), kiểm tra khi rời ô, trả về số nguyên đồng. */
export function MoneyInput({ value, onChange, allowNegative, id, required }: { value: number | null; onChange: (v: number | null) => void; allowNegative?: boolean; id?: string; required?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [err, setErr] = useState('');
  useEffect(() => { setText(value === null ? '' : value.toLocaleString('vi-VN')); }, [value]);
  const commit = (t: string) => {
    if (!t.trim()) { setErr(required ? 'Cần nhập số tiền' : ''); onChange(null); return; }
    const p = parseVndAmount(t);
    if (!p.ok) { setErr(p.error); onChange(null); return; }
    if (!allowNegative && p.value < 0) { setErr('Không được âm'); onChange(null); return; }
    setErr(''); onChange(p.value); setText(p.value.toLocaleString('vi-VN'));
  };
  return <>
    <input id={id} inputMode="decimal" value={text} aria-invalid={!!err} onChange={(e) => { setText(e.target.value); const p = parseVndAmount(e.target.value); if (p.ok && (allowNegative || p.value >= 0)) { onChange(p.value); setErr(''); } else if (e.target.value.trim()) onChange(null); }} onBlur={(e) => commit(e.target.value)} placeholder="VD: 1.500.000" />
    {err && <span className="small neg" role="alert">{err}</span>}
  </>;
}

// ---- Toast ----
type Toast = { id: number; kind: 'info' | 'error' | 'success'; text: string };
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4000);
  }, []);
  return <ToastCtx.Provider value={push}>{children}<div className="toasts" aria-live="polite">{list.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}</div></ToastCtx.Provider>;
}

/** Bọc thao tác bất đồng bộ: hiện lỗi dễ hiểu, chống bấm đúp. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
    if (busy) return undefined;
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast('success', okMsg); return r; }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Có lỗi xảy ra'); return undefined; }
    finally { setBusy(false); }
  }, [busy, toast]);
  return { run, busy };
}

export function Confirm({ title, children, confirmLabel, danger, onConfirm, onCancel }: { title: string; children: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Modal title={title} onClose={onCancel}>{children}<div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={onCancel}>Hủy</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button></div></Modal>;
}
