import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import type { LocationResponse, QueueResponse } from '../lib/apiTypes';
import { recordResolved, getActivity } from '../lib/ticketActivity';
import { alertDialog } from '../lib/dialogs';
import Select from './ui/Select';

const POLL_INTERVAL_MS = 10000;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/* ── icons ─────────────────────────────────────────────── */

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

/* ── sub-components ───────────────────────────────────── */

function StatusPill({ tone, children }: { tone: 'brand' | 'amber' | 'success' | 'danger'; children: React.ReactNode }) {
  const map = {
    brand:   { fg: 'var(--text-brand)', bg: 'var(--brand-subtle)',  bd: 'var(--brand-border)', dot: 'var(--brand)' },
    amber:   { fg: 'var(--amber-700)',  bg: 'var(--amber-50)',      bd: 'var(--amber-100)',    dot: 'var(--amber-500)' },
    success: { fg: 'var(--green-700)',  bg: 'var(--green-50)',      bd: 'var(--green-100)',    dot: 'var(--green-600)' },
    danger:  { fg: 'var(--red-700)',    bg: 'var(--red-50)',        bd: 'var(--red-100)',      dot: 'var(--red-600)' },
  } as const;
  const c = map[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
      padding: '4px 11px', borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.02em',
      background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {children}
    </span>
  );
}

function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '56px 24px', textAlign: 'center', color: 'var(--text-faint)' }}>
      <EmptyIcon />
      <p style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15, color: 'var(--text-muted)', margin: '14px 0 0' }}>{text}</p>
      {hint && <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--text-faint)', margin: '4px 0 0' }}>{hint}</p>}
    </div>
  );
}

/* ── main component ───────────────────────────────────── */

export default function UserQueue({ locationIds }: { userName: string; locationIds: number[] }) {
  const [allLocations, setAllLocations] = useState<LocationResponse[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<number | ''>('');
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [tab, setTab] = useState<'oczekujacy' | 'zakonczone'>('oczekujacy');
  const [, bumpActivity] = useState(0); // re-render po recordResolved(), żeby zakładka "Zakończone" od razu pokazała wpis

  useEffect(() => {
    api.get<LocationResponse[]>('/admin/locations')
      .then(locs => setAllLocations(locs.filter(l => locationIds.includes(l.id))))
      .catch(() => {});
  }, [locationIds]);

  const availableLocations = allLocations.filter(l => l.is_active);

  const refetchQueue = useCallback(async (locId: number) => {
    try {
      const q = await api.get<QueueResponse>(`/admin/locations/${locId}/queue`);
      setQueue(q);
    } catch {
      // zachowaj ostatni znany stan — kolejny poll spróbuje ponownie
    }
  }, []);

  useEffect(() => {
    if (selectedLocationId === '') { setQueue(null); return; }
    refetchQueue(selectedLocationId);
    const id = setInterval(() => refetchQueue(selectedLocationId), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [selectedLocationId, refetchQueue]);

  const selectLocation = (id: string) => {
    setSelectedLocationId(id ? Number(id) : '');
    setTab('oczekujacy');
  };

  const resolveServing = async (action: 'complete' | 'cancel') => {
    if (!queue?.serving || selectedLocationId === '') return;
    const ticket = queue.serving;
    try {
      await api.post(`/admin/tickets/${ticket.id}/${action}`);
      recordResolved({
        ticketId: ticket.id,
        ticketCode: ticket.ticket_code,
        customerName: ticket.customer_name,
        locationId: selectedLocationId,
        outcome: action === 'complete' ? 'done' : 'noshow',
        resolvedAt: new Date().toISOString(),
      });
      bumpActivity(n => n + 1);
      refetchQueue(selectedLocationId);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się wykonać akcji.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const callTicket = async (ticketId: string) => {
    if (selectedLocationId === '') return;
    try {
      await api.post(`/admin/tickets/${ticketId}/call`);
      refetchQueue(selectedLocationId);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się wezwać klienta.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const callFirstWaiting = () => {
    if (!queue || queue.waiting.length === 0) return;
    callTicket(queue.waiting[0].id);
  };

  const sessionCompleted = selectedLocationId !== ''
    ? getActivity().filter(a => a.locationId === selectedLocationId)
    : [];

  /* ── styles ─────────────────────────────────────────── */

  const btnDanger: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--red-500)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-md)', padding: '11px 18px',
    fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background var(--dur-fast)',
  };
  const btnPrimary: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
    borderRadius: 'var(--radius-md)', padding: '11px 18px',
    fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background var(--dur-fast)',
  };

  return (
    <div>
      {/* location picker */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', color: 'var(--text-faint)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" /><circle cx="12" cy="9" r="2.5" />
            </svg>
          </span>
          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>Lokalizacja</span>
        </div>

        {availableLocations.length === 0 ? (
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--red-600)', margin: 0 }}>
            Nie masz przypisanych żadnych lokalizacji. Skontaktuj się z administratorem.
          </p>
        ) : (
          <Select
            value={selectedLocationId === '' ? '' : String(selectedLocationId)}
            onChange={selectLocation}
            placeholder="— Wybierz lokalizację —"
            style={{ width: 240 }}
            options={availableLocations.map(loc => ({ value: String(loc.id), label: loc.name }))}
          />
        )}
      </div>

      {selectedLocationId === '' ? (
        <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)' }}>
          <EmptyState text="Wybierz lokalizację, aby zobaczyć kolejkę" hint="Kolejka na żywo pojawi się po wybraniu lokalizacji z listy powyżej." />
        </div>
      ) : queue && (
        <>
          {/* currently serving */}
          <div style={{
            background: 'var(--brand-subtle)', border: '1px solid var(--brand-border)',
            borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-brand)', textTransform: 'uppercase' }}>
                  Teraz obsługiwany
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 40, color: 'var(--text-brand)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                  {queue.serving ? queue.serving.ticket_code : '—'}
                </div>
              </div>
              {queue.serving && <StatusPill tone="brand">W TRAKCIE</StatusPill>}
            </div>

            {queue.serving ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  style={btnDanger}
                  onClick={() => resolveServing('cancel')}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--red-600)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--red-500)'; }}
                >
                  <XCircleIcon /> Nie zgłosił się
                </button>
                <button
                  style={btnPrimary}
                  onClick={() => resolveServing('complete')}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}
                >
                  <CheckCircleIcon /> Obsłużono · wezwij następnego
                </button>
              </div>
            ) : queue.waiting.length > 0 ? (
              <button
                style={btnPrimary}
                onClick={callFirstWaiting}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}
              >
                <CheckCircleIcon /> Wezwij pierwszego
              </button>
            ) : (
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-brand)' }}>Kolejka jest pusta</span>
            )}
          </div>

          {/* tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 0 }}>
            {(['oczekujacy', 'zakonczone'] as const).map(t => {
              const active = tab === t;
              const label = t === 'oczekujacy' ? 'Oczekujący' : 'Zakończone';
              const count = t === 'oczekujacy' ? queue.waiting.length : sessionCompleted.length;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '12px 16px', marginBottom: -1,
                    borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
                    fontFamily: 'var(--font-ui)', fontSize: 15, fontWeight: 700,
                    color: active ? 'var(--text-strong)' : 'var(--text-faint)',
                    transition: 'color var(--dur-fast), border-color var(--dur-fast)',
                  }}
                >
                  {label}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    minWidth: 20, height: 20, padding: '0 5px', borderRadius: 'var(--radius-pill)',
                    background: active ? 'var(--brand-subtle-2)' : 'var(--surface-sunken)',
                    color: active ? 'var(--text-brand)' : 'var(--text-faint)',
                    fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700,
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* list card */}
          <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
            {tab === 'oczekujacy' ? (
              queue.waiting.length === 0 ? (
                <EmptyState text="Brak oczekujących" hint="Wszyscy klienci zostali wezwani." />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {queue.waiting.map((entry, i) => (
                    <li key={entry.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                      padding: '18px 24px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', flexWrap: 'wrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {entry.ticket_code}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5, color: 'var(--text-strong)' }}>
                            {entry.customer_name || `Zgłoszenie ${entry.ticket_code}`}
                          </div>
                          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>
                            Dodano {formatTime(entry.joined_at)}{entry.appointment_time ? ` · wizyta ${entry.appointment_time}` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--text-muted)' }}>
                          <ClockIcon /> czeka {minutesSince(entry.joined_at)} min
                        </span>
                        <StatusPill tone="amber">OCZEKUJE</StatusPill>
                        <button
                          onClick={() => callTicket(entry.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14, color: 'var(--text-brand)', padding: '4px 2px' }}
                          onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                          onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
                        >
                          Wezwij
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              sessionCompleted.length === 0 ? (
                <EmptyState text="Brak zakończonych zgłoszeń w tej sesji" hint="Historia bieżącej zmiany — backend nie przechowuje jeszcze pełnej historii biletów." />
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {sessionCompleted.map((entry, i) => (
                    <li key={entry.ticketId} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
                      padding: '18px 24px', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)', flexWrap: 'wrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {entry.ticketCode}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5, color: 'var(--text-strong)' }}>
                            {entry.customerName || `Zgłoszenie ${entry.ticketCode}`}
                          </div>
                          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>Zakończono {formatTime(entry.resolvedAt)}</div>
                        </div>
                      </div>
                      <StatusPill tone={entry.outcome === 'done' ? 'success' : 'danger'}>
                        {entry.outcome === 'done' ? 'OBSŁUŻONO' : 'NIE ZGŁOSIŁ SIĘ'}
                      </StatusPill>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
