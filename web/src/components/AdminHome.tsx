import { useState, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { api } from '../lib/api';
import { ws } from '../lib/ws';
import { sortByName } from '../lib/sort';
import type { TabletResponse, UserResponse, LocationResponse, RefreshHandle } from '../lib/apiTypes';


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

function MiniBadge({ tone, children }: { tone: 'success' | 'neutral' | 'warning'; children: React.ReactNode }) {
  const map = {
    success: { fg: 'var(--green-700)', bg: 'var(--green-50)', bd: 'var(--green-100)', dot: 'var(--green-600)' },
    warning: { fg: 'var(--amber-700)', bg: 'var(--amber-50)', bd: 'var(--amber-100)', dot: 'var(--amber-600)' },
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
  tablet: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  users: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  pin: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" /><circle cx="12" cy="9" r="2.5" />
    </svg>
  ),
  wifi: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.55a11 11 0 0114.08 0" /><path d="M8.5 16.43a6 6 0 017 0" />
      <path d="M2 8.82a16 16 0 0120 0" /><line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
  alert: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  check: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
};


const AdminHome = forwardRef<RefreshHandle, { userName?: string }>(function AdminHome({ userName }, ref) {
  const [devices, setDevices] = useState<TabletResponse[]>([]);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [locations, setLocations] = useState<LocationResponse[]>([]);

  const refetch = useCallback(async () => {
    try {
      const [d, u, l] = await Promise.all([
        api.get<TabletResponse[]>('/admin/tablets'),
        api.get<UserResponse[]>('/admin/users'),
        api.get<LocationResponse[]>('/admin/locations'),
      ]);
      setDevices(d);
      setUsers(u);
      setLocations(l);
    } catch {
      // zachowaj ostatnio znane dane — WS dociągnie zmiany na żywo,
      // przycisk "Odśwież" pozwala spróbować ponownie ręcznie
    }
  }, []);

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    const initial = setTimeout(refetch, 0);
    return () => clearTimeout(initial);
  }, [refetch]);

  useEffect(() => {
    const offStatus = ws.on('device.status', msg => {
      const tabletId = msg.tablet_id as number;
      const online = msg.online as boolean;
      setDevices(prev => prev.map(d => d.id === tabletId ? { ...d, online } : d));
    });
    const offUpdated = ws.on('device.updated', msg => {
      const tablet = msg.tablet as TabletResponse;
      setDevices(prev => prev.map(d => d.id === tablet.id ? tablet : d));
    });
    return () => { offStatus(); offUpdated(); };
  }, []);

  const activeDevices = useMemo(() => devices.filter(d => d.is_active), [devices]);
  const activeUsers = useMemo(() => users.filter(u => u.is_active), [users]);
  const activeLocations = useMemo(() => locations.filter(l => l.is_active), [locations]);
  const onlineNow = useMemo(() => activeDevices.filter(d => d.online).length, [activeDevices]);

  const issues = useMemo(() => {
    const list: string[] = [];
    const unnamedDevices = activeDevices.filter(d => !d.name).length;
    const unassignedDevices = activeDevices.filter(d => !d.location_id).length;
    const tabletlessActiveLocations = activeLocations.filter(l => !l.tablet).length;
    const deactivatedUsers = users.filter(u => !u.is_active).length;

    if (unnamedDevices > 0) list.push(`${unnamedDevices} ${unnamedDevices === 1 ? 'tablet bez nazwy' : 'tabletów bez nazwy'}`);
    if (unassignedDevices > 0) list.push(`${unassignedDevices} ${unassignedDevices === 1 ? 'tablet bez lokalizacji' : 'tabletów bez przypisanej lokalizacji'}`);
    if (tabletlessActiveLocations > 0) list.push(`${tabletlessActiveLocations} ${tabletlessActiveLocations === 1 ? 'aktywna lokalizacja bez tabletu' : 'aktywnych lokalizacji bez tabletu'}`);
    if (deactivatedUsers > 0) list.push(`${deactivatedUsers} ${deactivatedUsers === 1 ? 'dezaktywowane konto' : 'dezaktywowanych kont'}`);
    return list;
  }, [activeDevices, activeLocations, users]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {userName && (
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 15, color: 'var(--text-muted)', margin: 0 }}>
          Cześć, <strong style={{ color: 'var(--text-body)' }}>{userName}</strong> — oto przegląd systemu eQue.
        </p>
      )}

      {}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <StatCard label="Aktywne tablety" value={activeDevices.length} unit={`/ ${devices.length}`} icon={ICON.tablet} />
        <StatCard label="Aktywni użytkownicy" value={activeUsers.length} unit={`/ ${users.length}`} icon={ICON.users} />
        <StatCard label="Aktywne lokalizacje" value={activeLocations.length} unit={`/ ${locations.length}`} icon={ICON.pin} />
        <StatCard label="Tablety online teraz" value={onlineNow} unit={`/ ${activeDevices.length}`} icon={ICON.wifi} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, alignItems: 'start' }}>
        {}
        <CardShell title="Lokalizacje — przegląd" subtitle="Stan tabletów i obsady w każdej lokalizacji">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {locations.length === 0 && (
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Brak dodanych lokalizacji.</p>
            )}
            {sortByName(locations, l => l.name).map((loc, i) => {
              const tabletLabel = loc.tablet ? (loc.tablet.name || 'Tablet bez nazwy') : 'Brak tabletu';
              const userCount = loc.user_ids.length;
              const active = loc.is_active;
              return (
                <div key={loc.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '11px 4px',
                  borderBottom: i < locations.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ display: 'flex', color: active ? 'var(--text-brand)' : 'var(--text-faint)', flexShrink: 0 }}>{ICON.pin}</span>
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600, color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {loc.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span style={{
                      fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-faint)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
                    }}>
                      {tabletLabel} · {userCount} os.
                    </span>
                    <MiniBadge tone={active ? 'success' : 'neutral'}>{active ? 'Aktywna' : 'Dezaktywowana'}</MiniBadge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardShell>

        {}
        <CardShell title="Wymaga uwagi" subtitle="Braki w konfiguracji systemu">
          {issues.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px' }}>
              {ICON.check}
              <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-body)' }}>
                Wszystko skonfigurowane poprawnie.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {issues.map(issue => (
                <div key={issue} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', background: 'var(--amber-50)', border: '1px solid var(--amber-100)', borderRadius: 'var(--radius-md)' }}>
                  <span style={{ display: 'flex', color: 'var(--amber-600)', flexShrink: 0, marginTop: 1 }}>{ICON.alert}</span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--amber-700)', lineHeight: 1.4 }}>{issue}</span>
                </div>
              ))}
            </div>
          )}
        </CardShell>
      </div>
    </div>
  );
});

export default AdminHome;
