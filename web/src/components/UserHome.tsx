import { useMemo, useState } from 'react';
import { seedLocationQueue } from '../lib/queueSim';

interface Location {
  id: string;
  name: string;
  active?: boolean;
}

interface UserData {
  id: string;
  fullName: string;
  locationIds: string[];
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

export default function UserHome({ userName }: { userName?: string }) {
  const [allLocations] = useState<Location[]>(() => {
    const saved = localStorage.getItem('eque_locations');
    return saved ? JSON.parse(saved) : [];
  });
  const [allUsers] = useState<UserData[]>(() => {
    const saved = localStorage.getItem('eque_users');
    return saved ? JSON.parse(saved) : [];
  });

  const currentUser = allUsers.find(u => u.fullName === userName);
  const assignedLocationIds = currentUser?.locationIds || [];
  const myLocations = allLocations.filter(l => assignedLocationIds.includes(l.id));
  const myActiveLocations = myLocations.filter(l => l.active ?? true);

  /* deterministic simulated snapshot — same seed the "Kolejka na żywo" tab uses */
  const snapshots = useMemo(
    () => Object.fromEntries(myActiveLocations.map(l => [l.id, seedLocationQueue(l.id)])),
    [myActiveLocations.map(l => l.id).join(',')]
  );

  const totalWaiting = myActiveLocations.reduce((sum, l) => sum + snapshots[l.id].waiting.length, 0);
  const totalServingNow = myActiveLocations.reduce((sum, l) => sum + (snapshots[l.id].serving ? 1 : 0), 0);
  const totalDoneToday = myActiveLocations.reduce((sum, l) => sum + snapshots[l.id].completed.filter(e => e.status === 'done').length, 0);
  const totalNoShowToday = myActiveLocations.reduce((sum, l) => sum + snapshots[l.id].completed.filter(e => e.status === 'noshow').length, 0);

  const upcoming = useMemo(() => {
    return myActiveLocations
      .flatMap(l => snapshots[l.id].waiting.map(entry => ({ ...entry, locationName: l.name })))
      .sort((a, b) => a.etaMin - b.etaMin)
      .slice(0, 5);
  }, [myActiveLocations, snapshots]);

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
              const active = loc.active ?? true;
              const snap = active ? snapshots[loc.id] : null;
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
                    {snap && (
                      <span style={{
                        fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-faint)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
                      }}>
                        Teraz: {snap.serving ? snap.serving.code : '—'} · {snap.waiting.length} oczekujących
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
        <CardShell title="Najbliżsi w kolejce" subtitle="Kolejni klienci we wszystkich Twoich lokalizacjach">
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
                      {entry.code}
                    </span>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {entry.locationName}
                    </span>
                  </div>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-faint)', flexShrink: 0 }}>
                    {ICON.clock} ~{entry.etaMin} min
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardShell>
      </div>
    </div>
  );
}
