import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { api } from '../lib/api';
import { ws, type WsMessage } from '../lib/ws';
import type { LocationResponse, QueueResponse, RefreshHandle } from '../lib/apiTypes';
import { getActivity } from '../lib/ticketActivity';

const POLL_INTERVAL_MS = 10000;

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/* ── sub-components (mirrors AdminHome's dashboard language) ─── */

function StatCard({ label, value, unit, icon, accent = 'var(--text-brand)' }: {
  label: string; value: string | number; unit?: string; icon: React.ReactNode; accent?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 20,
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>
          {label}
        </span>
        <span style={{
          width: 34, height: 34, borderRadius: 'var(--radius-md)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--brand-subtle)', color: accent,
        }}>
          {icon}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, color: 'var(--text-strong)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>
          {value}
        </span>
        {unit && <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  );
}

function CardShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16, color: 'var(--text-strong)' }}>{title}</div>
        {subtitle && <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function MiniBadge({ tone, children }: { tone: 'success' | 'neutral'; children: React.ReactNode }) {
  const map = {
    success: { fg: 'var(--green-700)', bg: 'var(--green-50)', bd: 'var(--green-100)', dot: 'var(--green-600)' },
    neutral: { fg: 'var(--slate-700)', bg: 'var(--slate-100)', bd: 'var(--slate-200)', dot: 'var(--slate-500)' },
  } as const;
  const c = map[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
      padding: '2px 9px', borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600,
      background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {children}
    </span>
  );
}

const ICON = {
  pin: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" /><circle cx="12" cy="9" r="2.5" />
    </svg>
  ),
  users: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  check: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  x: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  clock: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  checkBig: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
};

/* ── main component ───────────────────────────────────── */

const UserHome = forwardRef<RefreshHandle, { userName?: string; locationIds: number[] }>(function UserHome({ userName, locationIds }, ref) {
  const [myLocations, setMyLocations] = useState<LocationResponse[]>([]);
  const [queues, setQueues] = useState<Record<number, QueueResponse>>({});
  const [, bumpTick] = useState(0);

  const refetch = useCallback(async () => {
    try {
      const locs = (await api.get<LocationResponse[]>('/admin/locations')).filter(l => locationIds.includes(l.id));
      setMyLocations(locs);
      const active = locs.filter(l => l.is_active);
      const entries = await Promise.all(active.map(async l => {
        const q = await api.get<QueueResponse>(`/admin/locations/${l.id}/queue`);
        return [l.id, q] as const;
      }));
      setQueues(Object.fromEntries(entries));
    } catch {
      // zachowaj ostatnio znane dane — kolejny poll spróbuje ponownie
    }
    bumpTick(n => n + 1); // odśwież też liczniki z ticketActivity (czeka X min, itp.)
  }, [locationIds]);

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    const initial = setTimeout(refetch, 0);
    const id = setInterval(refetch, POLL_INTERVAL_MS);
    return () => { clearTimeout(initial); clearInterval(id); };
  }, [refetch]);

  /* Nowe zgłoszenie / wezwanie / zakończenie w jednej z Twoich lokalizacji —
     zamiast czekać na kolejny poll, odśwież kolejkę od razu (ticket.*). */
  useEffect(() => {
    const handler = (msg: WsMessage) => {
      const locId = (msg.ticket as { location_id?: number } | undefined)?.location_id;
      if (typeof locId === 'number' && locationIds.includes(locId)) refetch();
    };
    const offCreated = ws.on('ticket.created', handler);
    const offUpdated = ws.on('ticket.updated', handler);
    return () => { offCreated(); offUpdated(); };
  }, [locationIds, refetch]);

  const myActiveLocations = myLocations.filter(l => l.is_active);

  const totalWaiting = myActiveLocations.reduce((sum, l) => sum + (queues[l.id]?.waiting.length ?? 0), 0);
  const totalServingNow = myActiveLocations.reduce((sum, l) => sum + (queues[l.id]?.serving ? 1 : 0), 0);

  const activity = getActivity().filter(a => locationIds.includes(a.locationId));
  const totalDoneToday = activity.filter(a => a.outcome === 'done').length;
  const totalNoShowToday = activity.filter(a => a.outcome === 'noshow').length;

  const upcoming = myActiveLocations
    .flatMap(l => (queues[l.id]?.waiting ?? []).map(entry => ({ ...entry, locationName: l.name })))
    .sort((a, b) => minutesSince(b.joined_at) - minutesSince(a.joined_at))
    .slice(0, 5);

  if (myLocations.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {userName && (
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>
            Cześć, <strong style={{ color: 'var(--text-body)' }}>{userName}</strong> — oto Twój dzisiejszy przegląd.
          </p>
        )}
        <div style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 32, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, fontWeight: 600, color: 'var(--red-600)', margin: 0 }}>
            Nie masz przypisanych żadnych lokalizacji. Skontaktuj się z administratorem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {userName && (
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>
          Cześć, <strong style={{ color: 'var(--text-body)' }}>{userName}</strong> — oto Twój dzisiejszy przegląd.
        </p>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Lokalizacje" value={myActiveLocations.length} unit={`/ ${myLocations.length}`} icon={ICON.pin} />
        <StatCard label="W kolejce teraz" value={totalWaiting + totalServingNow} icon={ICON.users} />
        <StatCard label="Obsłużono dziś" value={totalDoneToday} icon={ICON.check} accent="var(--green-600)" />
        <StatCard label="Nie zgłosiło się" value={totalNoShowToday} icon={ICON.x} accent="var(--red-600)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* My locations overview */}
        <CardShell title="Twoje lokalizacje — przegląd" subtitle="Stan kolejki w każdej przypisanej lokalizacji">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {myLocations.map((loc, i) => {
              const active = loc.is_active;
              const q = active ? queues[loc.id] : undefined;
              return (
                <div key={loc.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '11px 4px',
                  borderBottom: i < myLocations.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ display: 'flex', color: active ? 'var(--text-brand)' : 'var(--text-faint)', flexShrink: 0 }}>{ICON.pin}</span>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {loc.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {q && (
                      <span style={{
                        fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-faint)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
                      }}>
                        Teraz: {q.serving ? q.serving.ticket_code : '—'} · {q.waiting.length} oczekujących
                      </span>
                    )}
                    <MiniBadge tone={active ? 'success' : 'neutral'}>{active ? 'Aktywna' : 'Dezaktywowana'}</MiniBadge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardShell>

        {/* Upcoming across locations */}
        <CardShell title="Najdłużej czekający" subtitle="Kolejni klienci we wszystkich Twoich lokalizacjach">
          {upcoming.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px' }}>
              {ICON.checkBig}
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-body)' }}>
                Brak oczekujących osób.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {upcoming.map(entry => (
                <div key={`${entry.locationName}-${entry.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 10px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {entry.ticket_code}
                    </span>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.locationName}
                    </span>
                  </div>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-faint)', flexShrink: 0 }}>
                    {ICON.clock} czeka {minutesSince(entry.joined_at)} min
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardShell>
      </div>
    </div>
  );
});

export default UserHome;
