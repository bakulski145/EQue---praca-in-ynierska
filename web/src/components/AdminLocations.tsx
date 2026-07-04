import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { api, ApiError } from '../lib/api';
import { ws } from '../lib/ws';
import { sortByName } from '../lib/sort';
import type { LocationResponse, TabletResponse, UserResponse, RefreshHandle } from '../lib/apiTypes';
import { confirmDialog, alertDialog } from '../lib/dialogs';
import Select from './ui/Select';

/* ── helpers ─────────────────────────────────────────── */

function pluralOsoby(n: number) {
  if (n === 1) return 'osoba';
  const lastDigit = n % 10;
  const lastTwo = n % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return 'osoby';
  return 'osób';
}

/* ── sub-components ───────────────────────────────────── */

function LocationIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a7 7 0 017 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 017-7z" /><circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

/** Odznaka z literą kodu kolejki lokalizacji (np. "A") — to ją klient wpisuje w apce mobilnej. */
function QueueCodeBadge({ code }: { code: string }) {
  return (
    <span title="Kod kolejki dla klientów" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
      background: 'var(--brand-subtle)', color: 'var(--text-brand)',
      fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13,
    }}>
      {code}
    </span>
  );
}

function StatusBadge({ tone, children }: { tone: 'success' | 'neutral'; children: React.ReactNode }) {
  const map = {
    success: { fg: 'var(--green-700)', bg: 'var(--green-50)', bd: 'var(--green-100)', dot: 'var(--green-600)' },
    neutral: { fg: 'var(--slate-700)', bg: 'var(--slate-100)', bd: 'var(--slate-200)', dot: 'var(--slate-500)' },
  } as const;
  const c = map[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
      padding: '3px 10px', borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-ui)', fontSize: 13, fontWeight: 600,
      background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
      {children}
    </span>
  );
}

function Switch({ checked, onChange, ariaLabel }: { checked: boolean; onChange: () => void; ariaLabel: string }) {
  const w = 44, h = 24, k = 18;
  return (
    <button
      role="switch" aria-checked={checked} aria-label={ariaLabel}
      onClick={onChange}
      style={{
        position: 'relative', width: w, height: h, flexShrink: 0,
        borderRadius: 'var(--radius-pill)', border: 'none', padding: 0,
        background: checked ? 'var(--brand)' : 'var(--slate-300)',
        cursor: 'pointer', transition: 'background var(--dur-base) var(--ease-out)',
      }}
    >
      <span style={{
        position: 'absolute', top: (h - k) / 2,
        left: checked ? w - k - (h - k) / 2 : (h - k) / 2,
        width: k, height: k, borderRadius: '50%', background: '#fff',
        boxShadow: 'var(--shadow-sm)', transition: 'left var(--dur-base) var(--ease-out)',
      }} />
    </button>
  );
}

/* ── slide panel (matches AdminUsers / AdminDashboard) ── */

function SlidePanel({ title, open, onClose, children, footer }: {
  title: string; open: boolean; onClose: () => void;
  children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <>
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(12,16,19,0.45)' }} onClick={onClose} />}
      <aside style={{
        position: 'fixed', inset: '0 0 0 auto', zIndex: 50,
        width: '100%', maxWidth: 440,
        background: 'var(--surface-card)',
        boxShadow: '0 18px 48px rgba(21,27,31,0.16)',
        display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 250ms cubic-bezier(0.22,1,0.36,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--text-strong)' }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', display: 'flex', padding: 4, borderRadius: 'var(--radius-sm)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>{children}</div>
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--surface-sunken)' }}>
          {footer}
        </div>
      </aside>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

/* ── shared styles ─────────────────────────────────────── */

const btnPrimary: React.CSSProperties = {
  background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
  borderRadius: 'var(--radius-md)', padding: '10px 20px',
  fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
  background: 'var(--red-50)', color: 'var(--red-600)', border: '1.5px solid var(--red-100)',
  borderRadius: 'var(--radius-md)', padding: '10px 20px',
  fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14.5, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: '100%', border: '1.5px solid var(--border-default)',
  borderRadius: 'var(--radius-md)', padding: '11px 14px',
  fontFamily: 'var(--font-ui)', fontSize: 15,
  color: 'var(--text-strong)', background: 'var(--surface-card)',
  outline: 'none', boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 7,
  fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600,
  color: 'var(--text-body)',
};

/* ── local edit-draft shape ────────────────────────────── */

interface LocationDraft {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  queue_code: string;
  tablet_id: number | null;
  user_ids: string[];
}

/* ── main component ───────────────────────────────────── */

const AdminLocations = forwardRef<RefreshHandle, { addOpen?: boolean; onAddClose?: () => void; searchQuery?: string }>(function AdminLocations({ addOpen = false, onAddClose, searchQuery = '' }, ref) {
  const [locations, setLocations] = useState<LocationResponse[]>([]);
  const [tablets, setTablets] = useState<TabletResponse[]>([]);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const [l, t, u] = await Promise.all([
        api.get<LocationResponse[]>('/admin/locations'),
        api.get<TabletResponse[]>('/admin/tablets'),
        api.get<UserResponse[]>('/admin/users'),
      ]);
      setLocations(l);
      setTablets(t);
      setUsers(u);
    } catch {
      // zachowaj ostatnio znane dane — WS dociągnie zmiany na żywo,
      // przycisk "Odśwież" pozwala spróbować ponownie ręcznie
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    const initial = setTimeout(refetch, 0);
    return () => clearTimeout(initial);
  }, [refetch]);

  /* Live-update z WebSocketa (location.* i device.*) — patrz API_SPEC.md sekcja 5. */
  useEffect(() => {
    const offLocCreated = ws.on('location.created', msg => {
      const location = msg.location as LocationResponse;
      setLocations(prev => prev.some(l => l.id === location.id) ? prev : [...prev, location]);
    });
    const offLocUpdated = ws.on('location.updated', msg => {
      const location = msg.location as LocationResponse;
      setLocations(prev => prev.map(l => l.id === location.id ? location : l));
    });
    const offLocDeleted = ws.on('location.deleted', msg => {
      const locationId = msg.location_id as number;
      setLocations(prev => prev.filter(l => l.id !== locationId));
    });
    const offTabletUpdated = ws.on('device.updated', msg => {
      const tablet = msg.tablet as TabletResponse;
      setTablets(prev => prev.map(t => t.id === tablet.id ? tablet : t));
    });
    const offTabletCreated = ws.on('device.created', msg => {
      const tablet = msg.tablet as TabletResponse;
      setTablets(prev => prev.some(t => t.id === tablet.id) ? prev : [...prev, tablet]);
    });
    const offTabletDeleted = ws.on('device.deleted', msg => {
      const tabletId = msg.tablet_id as number;
      setTablets(prev => prev.filter(t => t.id !== tabletId));
    });
    return () => {
      offLocCreated(); offLocUpdated(); offLocDeleted();
      offTabletUpdated(); offTabletCreated(); offTabletDeleted();
    };
  }, []);

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const [editingLocation, setEditingLocation] = useState<LocationDraft | null>(null);

  const openEditLocation = (location: LocationResponse) => {
    setEditingLocation({
      id: location.id,
      name: location.name,
      description: location.description ?? '',
      is_active: location.is_active,
      queue_code: location.queue_code,
      tablet_id: location.tablet?.id ?? null,
      user_ids: [...location.user_ids],
    });
  };

  const handleToggleActive = async (location: LocationResponse) => {
    if (location.is_active) {
      const ok = await confirmDialog(
        `Czy na pewno chcesz dezaktywować lokalizację "${location.name}"? Przypisany tablet i użytkownicy zostaną od niej odłączeni.`,
        { title: 'Dezaktywuj lokalizację', tone: 'danger', confirmLabel: 'Dezaktywuj' }
      );
      if (!ok) return;
    }
    try {
      const updated = await api.post<LocationResponse>(`/admin/locations/${location.id}/${location.is_active ? 'deactivate' : 'activate'}`);
      setLocations(prev => prev.map(l => l.id === updated.id ? updated : l));
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zmienić statusu lokalizacji.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleAddLocation = async () => {
    if (!newName.trim()) return;
    try {
      const created = await api.post<LocationResponse>('/admin/locations', {
        name: newName.trim(),
        description: newDescription.trim() || null,
      });
      setLocations(prev => prev.some(l => l.id === created.id) ? prev : [...prev, created]);
      onAddClose?.();
      setNewName('');
      setNewDescription('');
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się dodać lokalizacji.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleDeleteLocation = async () => {
    if (!editingLocation) return;
    const ok = await confirmDialog(
      `Czy na pewno chcesz usunąć lokalizację "${editingLocation.name}"? Tej operacji nie można cofnąć.`,
      { title: 'Usuń lokalizację', tone: 'danger', confirmLabel: 'Usuń' }
    );
    if (!ok) return;
    try {
      await api.del(`/admin/locations/${editingLocation.id}`);
      setLocations(prev => prev.filter(l => l.id !== editingLocation.id));
      setEditingLocation(null);
      refetch(); // odśwież tablety — jeden mógł zostać odłączony kaskadowo
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się usunąć lokalizacji.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleSaveEdit = async () => {
    if (!editingLocation) return;
    try {
      const updated = await api.put<LocationResponse>(`/admin/locations/${editingLocation.id}`, {
        name: editingLocation.name,
        description: editingLocation.description,
        tablet_id: editingLocation.tablet_id,
        user_ids: editingLocation.user_ids,
      });
      setLocations(prev => prev.map(l => l.id === updated.id ? updated : l));
      setEditingLocation(null);
      refetch(); // odśwież tablety — poprzedni najemca mógł zostać odłączony
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zapisać zmian.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const visibleLocations = sortByName(
    searchQuery.trim()
      ? locations.filter(l => l.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : locations,
    l => l.name
  );

  /* ── render ────────────────────────────────────────── */
  return (
    <div>
      <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1.3fr 1.3fr 1fr 96px',
          gap: 12, padding: '12px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)',
        }}>
          <span>Lokalizacja</span><span>Tablet</span><span>Użytkownicy</span><span>Status</span><span></span>
        </div>

        {!loading && visibleLocations.length === 0 && (
          <div style={{ padding: 36, textAlign: 'center', fontFamily: 'var(--font-ui)', color: 'var(--text-muted)', fontSize: 15 }}>
            {locations.length === 0 ? 'Brak dodanych lokalizacji.' : 'Brak lokalizacji pasujących do wyszukiwania.'}
          </div>
        )}

        {visibleLocations.map((location, i) => {
          const tablet = location.tablet;
          const userCount = location.user_ids.length;

          return (
            <div
              key={location.id}
              style={{
                display: 'grid', gridTemplateColumns: '2fr 1.3fr 1.3fr 1fr 96px',
                gap: 12, alignItems: 'center', padding: '17px 24px',
                background: location.is_active ? 'transparent' : 'var(--surface-sunken)',
                borderBottom: i < visibleLocations.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                transition: 'background var(--dur-base) var(--ease-out)',
              }}
            >
              {/* Icon + name + description */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 'var(--radius-md)', flexShrink: 0,
                  background: location.is_active ? 'var(--brand-subtle)' : 'var(--surface-card)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: location.is_active ? 'var(--text-brand)' : 'var(--text-faint)',
                }}>
                  <LocationIcon size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15.5, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {location.name}
                    </span>
                    <QueueCodeBadge code={location.queue_code} />
                  </div>
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {location.description || 'Brak opisu'}
                  </div>
                </div>
              </div>

              {/* Tablet */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={tablet ? 'var(--text-muted)' : 'var(--text-faint)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
                <span style={{
                  fontFamily: 'var(--font-ui)', fontSize: 13.5,
                  color: tablet ? 'var(--text-body)' : 'var(--text-faint)',
                  fontStyle: tablet ? 'normal' : 'italic',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {tablet ? (tablet.name || 'Tablet bez nazwy') : 'Brak przypisanego'}
                </span>
              </div>

              {/* Users */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5 }}>{userCount} {pluralOsoby(userCount)}</span>
              </div>

              {/* Status */}
              <div>
                <StatusBadge tone={location.is_active ? 'success' : 'neutral'}>
                  {location.is_active ? 'Aktywna' : 'Dezaktywowana'}
                </StatusBadge>
              </div>

              {/* Actions: deactivate switch + edit */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <Switch
                  checked={location.is_active}
                  onChange={() => handleToggleActive(location)}
                  ariaLabel={location.is_active ? `Dezaktywuj lokalizację ${location.name}` : `Aktywuj lokalizację ${location.name}`}
                />
                <button
                  onClick={() => openEditLocation(location)}
                  title="Edytuj"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                    transition: 'background var(--dur-fast), color var(--dur-fast)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-body)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-faint)'; }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Add panel ─────────────────────────────────── */}
      <SlidePanel title="Nowa lokalizacja" open={addOpen} onClose={() => onAddClose?.()} footer={
        <>
          <button style={btnPrimary} onClick={handleAddLocation}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}>
            Dodaj
          </button>
        </>
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label="Nazwa lokalizacji">
            <input style={inputStyle} type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="np. Gabinet 12"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
          </Field>
          <Field label="Opis (opcjonalnie)">
            <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={3} value={newDescription} onChange={e => setNewDescription(e.target.value)}
              placeholder="np. Piętro 1, skrzydło wschodnie"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
          </Field>
        </div>
      </SlidePanel>

      {/* ── Edit panel ────────────────────────────────── */}
      <SlidePanel title="Edytuj lokalizację" open={!!editingLocation} onClose={() => setEditingLocation(null)} footer={
        <>
          <button style={btnDanger} onClick={handleDeleteLocation}>Usuń</button>
          <button style={{ ...btnPrimary, marginLeft: 'auto' }} onClick={handleSaveEdit}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}>
            Zapisz
          </button>
        </>
      }>
        {editingLocation && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)' }}>
              <div style={{
                width: 48, height: 48, borderRadius: 'var(--radius-md)', flexShrink: 0,
                background: editingLocation.is_active ? 'var(--brand-subtle)' : 'var(--surface-card)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: editingLocation.is_active ? 'var(--text-brand)' : 'var(--text-faint)',
              }}>
                <LocationIcon size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16, color: 'var(--text-strong)' }}>
                    {editingLocation.name || '—'}
                  </span>
                  <QueueCodeBadge code={editingLocation.queue_code} />
                </div>
                <div style={{ marginTop: 5 }}>
                  <StatusBadge tone={editingLocation.is_active ? 'success' : 'neutral'}>
                    {editingLocation.is_active ? 'Aktywna' : 'Dezaktywowana'}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-faint)', margin: '-8px 0 0' }}>
              Kod kolejki „{editingLocation.queue_code}” wpisują klienci w aplikacji mobilnej, aby dołączyć do tej kolejki. Jest nadawany automatycznie i się nie zmienia.
            </p>

            <Field label="Nazwa lokalizacji">
              <input style={inputStyle} type="text" value={editingLocation.name}
                onChange={e => setEditingLocation({ ...editingLocation, name: e.target.value })}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
            </Field>

            <Field label="Opis">
              <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={3} value={editingLocation.description}
                onChange={e => setEditingLocation({ ...editingLocation, description: e.target.value })}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
            </Field>

            <Field label="Przypisany tablet">
              {!editingLocation.is_active ? (
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
                  Aktywuj lokalizację, aby przypisać tablet.
                </p>
              ) : (
                <Select
                  value={editingLocation.tablet_id !== null ? String(editingLocation.tablet_id) : ''}
                  onChange={v => setEditingLocation({ ...editingLocation, tablet_id: v ? Number(v) : null })}
                  placeholder="Brak przypisanego tabletu"
                  options={[
                    { value: '', label: 'Brak przypisanego tabletu' },
                    ...sortByName(tablets.filter(t => t.is_active), t => t.name).map(t => ({
                      value: String(t.id),
                      label: `${t.name || 'Tablet bez nazwy'}${t.location_id && t.location_id !== editingLocation.id ? ' (przypisany gdzie indziej)' : ''}`,
                    })),
                  ]}
                />
              )}
            </Field>

            <Field label="Przypisani użytkownicy">
              {!editingLocation.is_active ? (
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
                  Aktywuj lokalizację, aby przypisać użytkowników.
                </p>
              ) : (() => {
                const assignableUsers = sortByName(users.filter(u => u.is_active && u.role === 'OPERATOR'), u => u.full_name);
                return (
                  <div style={{ border: '1.5px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {assignableUsers.map((user, i) => (
                      <label key={user.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 16px', cursor: 'pointer',
                        borderBottom: i < assignableUsers.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        background: editingLocation.user_ids.includes(user.id) ? 'var(--brand-subtle)' : 'transparent',
                      }}>
                        <input type="checkbox"
                          checked={editingLocation.user_ids.includes(user.id)}
                          onChange={e => {
                            const ids = e.target.checked
                              ? [...editingLocation.user_ids, user.id]
                              : editingLocation.user_ids.filter(id => id !== user.id);
                            setEditingLocation({ ...editingLocation, user_ids: ids });
                          }}
                          style={{ accentColor: 'var(--brand)', width: 16, height: 16 }} />
                        <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, fontWeight: 600, color: 'var(--text-body)' }}>{user.full_name}</span>
                      </label>
                    ))}
                    {assignableUsers.length === 0 && (
                      <div style={{ padding: 16, fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)' }}>Brak dostępnych użytkowników</div>
                    )}
                  </div>
                );
              })()}
            </Field>
          </div>
        )}
      </SlidePanel>
    </div>
  );
});

export default AdminLocations;
