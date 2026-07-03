import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

type Tone = 'default' | 'danger';

interface DialogOptions {
  title?: string;
  tone?: Tone;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface DialogRequest extends DialogOptions {
  kind: 'confirm' | 'alert';
  message: string;
  resolve: (value: boolean) => void;
}

let dispatch: ((req: DialogRequest) => void) | null = null;

function request(kind: DialogRequest['kind'], message: string, opts: DialogOptions): Promise<boolean> {
  return new Promise(resolve => {
    const req: DialogRequest = { kind, message, resolve, ...opts };
    if (dispatch) dispatch(req);
    else resolve(kind === 'alert' ? true : window.confirm(message)); // siatka bezpieczeństwa gdyby <DialogHost/> nie był zamontowany
  });
}

/** Zastępuje window.confirm — rozwiązuje się do true/false zależnie od wyboru użytkownika. */
export function confirmDialog(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return request('confirm', message, opts);
}

/** Zastępuje window.alert — rozwiązuje się po kliknięciu OK. */
export function alertDialog(message: string, opts: DialogOptions = {}): Promise<void> {
  return request('alert', message, opts).then(() => undefined);
}

/* ── ikony ─────────────────────────────────────────────── */

function WarnIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

/* ── style ─────────────────────────────────────────────── */

const btnBase: React.CSSProperties = {
  borderRadius: 'var(--radius-md)', padding: '10px 20px',
  fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
  transition: 'background var(--dur-fast), transform 120ms var(--ease-out)',
};
const btnSecondary: React.CSSProperties = {
  ...btnBase, background: 'transparent', color: 'var(--text-body)',
  border: '1.5px solid var(--border-default)', fontWeight: 600,
};
const btnPrimary: React.CSSProperties = {
  ...btnBase, background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
};
const btnDangerSolid: React.CSSProperties = {
  ...btnBase, background: 'var(--red-500)', color: '#fff', border: 'none',
};

/** Mont raz w drzewie aplikacji (np. w App.tsx) — renderuje aktualnie zgłoszony dialog. */
export function DialogHost() {
  const [pending, setPending] = useState<DialogRequest | null>(null);
  const [visible, setVisible] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dispatch = (req) => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      setPending(req);
      requestAnimationFrame(() => setVisible(true));
    };
    return () => { dispatch = null; };
  }, []);

  const settle = useCallback((value: boolean) => {
    setVisible(false);
    closeTimer.current = setTimeout(() => {
      setPending(p => { p?.resolve(value); return null; });
    }, 200);
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  if (!pending) return null;

  const danger = pending.tone === 'danger';

  return createPortal(
    <div
      onClick={() => settle(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        background: visible ? 'rgba(12,16,19,0.5)' : 'rgba(12,16,19,0)',
        backdropFilter: visible ? 'blur(2px)' : 'blur(0px)',
        transition: 'background 220ms var(--ease-out), backdrop-filter 220ms var(--ease-out)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400, background: 'var(--surface-card)',
          borderRadius: 'var(--radius-xl)', boxShadow: '0 24px 60px rgba(21,27,31,0.28)',
          padding: 26,
          transform: visible ? 'scale(1) translateY(0)' : 'scale(0.92) translateY(10px)',
          opacity: visible ? 1 : 0,
          transition: 'transform 280ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms var(--ease-out)',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <span style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: danger ? 'var(--red-50)' : 'var(--brand-subtle)',
            color: danger ? 'var(--red-600)' : 'var(--text-brand)',
          }}>
            {danger ? <WarnIcon /> : <InfoIcon />}
          </span>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
            {pending.title && (
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--text-strong)', marginBottom: 6 }}>
                {pending.title}
              </div>
            )}
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, color: 'var(--text-body)', margin: 0, lineHeight: 1.5 }}>
              {pending.message}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          {pending.kind === 'confirm' && (
            <button
              style={btnSecondary}
              onClick={() => settle(false)}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {pending.cancelLabel ?? 'Anuluj'}
            </button>
          )}
          <button
            style={danger ? btnDangerSolid : btnPrimary}
            onClick={() => settle(true)}
            onMouseEnter={e => { e.currentTarget.style.background = danger ? 'var(--red-600)' : 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = danger ? 'var(--red-500)' : 'var(--brand)'; }}
          >
            {pending.confirmLabel ?? (pending.kind === 'confirm' ? 'Potwierdź' : 'OK')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
