import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { api, ApiError } from '../lib/api';
import { ws } from '../lib/ws';
import { sortByName } from '../lib/sort';
import type { TabletResponse, LocationResponse, RefreshHandle } from '../lib/apiTypes';
import { confirmDialog, alertDialog } from '../lib/dialogs';
import Select from './ui/Select';

function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Nigdy nie było online';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 60000));
  if (minutes < 1) return 'Widziano przed chwilą';
  if (minutes < 60) return `Widziano ${minutes} min temu`;
  const hours = Math.round(minutes / 60);
  return `Widziano ${hours} godz. temu`;
}

/* ── sub-components ───────────────────────────────────── */

function StatusBadge({ tone, children }: { tone: 'success' | 'danger' | 'neutral'; children: React.ReactNode }) {
  const map = {
    success: { fg: 'var(--green-700)', bg: 'var(--green-50)', bd: 'var(--green-100)', dot: 'var(--green-600)' },
    danger:  { fg: 'var(--red-700)',   bg: 'var(--red-50)',   bd: 'var(--red-100)',   dot: 'var(--red-600)' },
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

function EditIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
  );
}

function TabletIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" /><line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

/** Pole tylko-do-odczytu z tokenem parowania + przyciskiem kopiowania. */
function TokenField({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // schowek niedostępny (np. brak uprawnień) — token można i tak zaznaczyć ręcznie
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{
        ...inputStyle, flex: 1, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.04em',
        display: 'flex', alignItems: 'center', background: 'var(--surface-sunken)',
      }}>
        {token}
      </div>
      <button
        onClick={handleCopy}
        title="Kopiuj token"
        style={{ ...btnSecondary, padding: '0 16px', minWidth: 96 }}
      >
        {copied ? 'Skopiowano!' : 'Kopiuj'}
      </button>
    </div>
  );
}

/* ── slide panel (matches AdminUsers) ─────────────────── */

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
const btnSecondary: React.CSSProperties = {
  background: 'transparent', color: 'var(--text-body)',
  border: '1.5px solid var(--border-default)',
  borderRadius: 'var(--radius-md)', padding: '10px 20px',
  fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 14.5, cursor: 'pointer',
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

/* ── main component ───────────────────────────────────── */

const AdminDashboard = forwardRef<RefreshHandle, { addOpen?: boolean; onAddClose?: () => void; searchQuery?: string }>(function AdminDashboard({ addOpen = false, onAddClose, searchQuery = '' }, ref) {
  const [locations, setLocations] = useState<LocationResponse[]>([]);
  const [devices, setDevices] = useState<TabletResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([
        api.get<TabletResponse[]>('/admin/tablets'),
        api.get<LocationResponse[]>('/admin/locations'),
      ]);
      setDevices(t);
      setLocations(l);
    } catch {
      // zachowaj ostatnio znane dane — WS dociągnie zmiany na żywo,
      // przycisk "Odśwież" pozwala spróbować ponownie ręcznie
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ refetch }), [refetch]);

  useEffect(() => {
    // setTimeout(…, 0) zamiast bezpośredniego refetch() w ciele efektu —
    // refetch() jest zawsze wywoływane z callbacku timera, nigdy synchronicznie.
    const initial = setTimeout(refetch, 0);
    return () => clearTimeout(initial);
  }, [refetch]);

  /* Live-update z WebSocketa — patrz API_SPEC.md sekcja 5 (device.*). Gdyby
     połączenie WS na chwilę padło, App.tsx dociągnie stan po jego powrocie. */
  useEffect(() => {
    const offCreated = ws.on('device.created', msg => {
      const tablet = msg.tablet as TabletResponse;
      setDevices(prev => prev.some(d => d.id === tablet.id) ? prev : [...prev, tablet]);
    });
    const offUpdated = ws.on('device.updated', msg => {
      const tablet = msg.tablet as TabletResponse;
      setDevices(prev => prev.map(d => d.id === tablet.id ? tablet : d));
    });
    const offDeleted = ws.on('device.deleted', msg => {
      const tabletId = msg.tablet_id as number;
      setDevices(prev => prev.filter(d => d.id !== tabletId));
    });
    const offStatus = ws.on('device.status', msg => {
      const tabletId = msg.tablet_id as number;
      const online = msg.online as boolean;
      setDevices(prev => prev.map(d => d.id === tabletId ? { ...d, online } : d));
    });
    return () => { offCreated(); offUpdated(); offDeleted(); offStatus(); };
  }, []);

  const [editingDevice, setEditingDevice] = useState<TabletResponse | null>(null);

  const openEdit = (device: TabletResponse) => setEditingDevice({ ...device });

  const handleToggleActive = async (device: TabletResponse) => {
    if (device.is_active) {
      const ok = await confirmDialog(
        `Czy na pewno chcesz dezaktywować tablet "${device.name || 'bez nazwy'}"? Zostanie odłączony od przypisanej lokalizacji, a na jego ekranie pojawi się komunikat o wyłączeniu — token pozostaje zapamiętany, więc po ponownym włączeniu wróci sam.`,
        { title: 'Dezaktywuj tablet', tone: 'danger', confirmLabel: 'Dezaktywuj' }
      );
      if (!ok) return;
    }
    try {
      const updated = await api.post<TabletResponse>(`/admin/tablets/${device.id}/${device.is_active ? 'deactivate' : 'activate'}`);
      setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
      setEditingDevice(prev => prev && prev.id === updated.id ? updated : prev);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zmienić statusu tabletu.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleResetPairing = async (device: TabletResponse) => {
    const ok = await confirmDialog(
      `Czy na pewno chcesz zresetować token parowania tabletu "${device.name || 'bez nazwy'}"? Obecnie sparowane urządzenie zostanie wylogowane i będzie wymagało ponownego wpisania nowego tokenu w aplikacji mobilnej.`,
      { title: 'Resetuj token parowania', tone: 'danger', confirmLabel: 'Resetuj' }
    );
    if (!ok) return;
    try {
      const updated = await api.post<TabletResponse>(`/admin/tablets/${device.id}/reset-pairing`);
      setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
      setEditingDevice(prev => prev && prev.id === updated.id ? updated : prev);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zresetować tokenu.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const [createdTablet, setCreatedTablet] = useState<TabletResponse | null>(null);

  const handleCreateTablet = async () => {
    try {
      const created = await api.post<TabletResponse>('/admin/tablets', { name: '', location_id: null });
      setDevices(prev => prev.some(d => d.id === created.id) ? prev : [...prev, created]);
      setCreatedTablet(created);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się dodać tabletu.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const closeAddModal = () => {
    setCreatedTablet(null);
    onAddClose?.();
  };

  const handleSaveEdit = async () => {
    if (!editingDevice) return;
    try {
      const updated = await api.put<TabletResponse>(`/admin/tablets/${editingDevice.id}`, {
        name: editingDevice.name,
        location_id: editingDevice.location_id,
      });
      setDevices(prev => prev.map(d => d.id === updated.id ? updated : d));
      setEditingDevice(null);
      refetch(); // odśwież lokalizacje — poprzedni najemca mógł zostać odłączony
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zapisać zmian.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleDeleteDevice = async () => {
    if (!editingDevice) return;
    const ok = await confirmDialog(
      `Czy na pewno chcesz usunąć tablet "${editingDevice.name || 'bez nazwy'}"?`,
      { title: 'Usuń tablet', tone: 'danger', confirmLabel: 'Usuń' }
    );
    if (!ok) return;
    try {
      await api.del(`/admin/tablets/${editingDevice.id}`);
      setDevices(prev => prev.filter(d => d.id !== editingDevice.id));
      setEditingDevice(null);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się usunąć tabletu.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const getLocationName = (locId: number | null) => locations.find(l => l.id === locId)?.name ?? '';

  const visibleDevices = sortByName(
    searchQuery.trim()
      ? devices.filter(d => d.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : devices,
    d => d.name
  );

  /* ── render ────────────────────────────────────────── */
  return (
    <div>
      {!loading && visibleDevices.length === 0 ? (
        <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', padding: 40, textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-ui)', color: 'var(--text-muted)', fontSize: 15, margin: 0 }}>
            {devices.length === 0 ? 'Brak dodanych tabletów.' : 'Brak tabletów pasujących do wyszukiwania.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
          {visibleDevices.map(device => {
            const nameMissing = !device.name;
            const locMissing = !device.location_id;
            const badge = !device.is_active
              ? { tone: 'neutral' as const, label: 'Dezaktywowany' }
              : device.online
                ? { tone: 'success' as const, label: 'Online' }
                : { tone: 'danger' as const, label: 'Offline' };

            return (
              <div key={device.id} style={{
                background: device.is_active ? 'var(--surface-card)' : 'var(--surface-sunken)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: 20,
                transition: 'background var(--dur-base) var(--ease-out)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 14, minWidth: 0 }}>
                    <div style={{
                      width: 46, height: 46, borderRadius: 'var(--radius-md)', flexShrink: 0,
                      background: device.is_active ? 'var(--brand-subtle)' : 'var(--surface-sunken)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: device.is_active ? 'var(--text-brand)' : 'var(--text-faint)',
                    }}>
                      <TabletIcon />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15.5,
                        color: nameMissing ? 'var(--red-600)' : 'var(--text-strong)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {nameMissing ? 'Nazwa nie została ustawiona' : device.name}
                      </div>
                      <div style={{
                        fontFamily: 'var(--font-ui)', fontSize: 13, marginTop: 2,
                        color: locMissing ? 'var(--red-600)' : 'var(--text-muted)',
                      }}>
                        {locMissing ? 'Brak przypisanej lokalizacji' : getLocationName(device.location_id)}
                      </div>
                    </div>
                  </div>
                  <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 13 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    {device.online ? 'Aktywny teraz' : formatLastSeen(device.last_seen_at)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Switch checked={device.is_active} onChange={() => handleToggleActive(device)} ariaLabel={device.is_active ? 'Dezaktywuj tablet' : 'Aktywuj tablet'} />
                    <EditIconButton onClick={() => openEdit(device)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add device modal ──────────────────────────────── */}
      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12,16,19,0.55)', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 400, background: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', padding: 28, boxShadow: '0 18px 48px rgba(21,27,31,0.16)' }}>
            {!createdTablet ? (
              <>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--text-strong)', textAlign: 'center', marginBottom: 6 }}>Dodaj nowy tablet</h3>
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 24 }}>
                  Wygenerujemy token parowania. Wpisz go w aplikacji mobilnej na tablecie, w zakładce „Konfiguracja kiosku”.
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={{ ...btnSecondary, flex: 1 }} onClick={closeAddModal}>Anuluj</button>
                  <button
                    style={{ ...btnPrimary, flex: 1 }}
                    onClick={handleCreateTablet}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--brand)'; }}
                  >
                    Utwórz tablet
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: 'var(--text-strong)', textAlign: 'center', marginBottom: 6 }}>Tablet utworzony</h3>
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 20 }}>
                  Wpisz ten token w aplikacji mobilnej na tablecie („Konfiguracja kiosku”), aby uruchomić kiosk. Następnie przypisz tabletowi lokalizację poniżej w edycji.
                </p>
                <div style={{ marginBottom: 24 }}>
                  <TokenField token={createdTablet.pairing_token ?? ''} />
                </div>
                <button
                  style={{ ...btnPrimary, width: '100%' }}
                  onClick={closeAddModal}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--brand)'; }}
                >
                  Gotowe
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Edit panel ────────────────────────────────── */}
      <SlidePanel title="Edytuj tablet" open={!!editingDevice} onClose={() => setEditingDevice(null)} footer={
        <>
          <button style={btnDanger} onClick={handleDeleteDevice}>Usuń</button>
          <button style={{ ...btnPrimary, marginLeft: 'auto' }} onClick={handleSaveEdit}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}>
            Zapisz
          </button>
        </>
      }>
        {editingDevice && (() => {
          const editBadge = !editingDevice.is_active
            ? { tone: 'neutral' as const, label: 'Dezaktywowany' }
            : editingDevice.online
              ? { tone: 'success' as const, label: 'Online' }
              : { tone: 'danger' as const, label: 'Offline' };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 'var(--radius-md)', flexShrink: 0,
                  background: editingDevice.is_active ? 'var(--brand-subtle)' : 'var(--surface-card)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: editingDevice.is_active ? 'var(--text-brand)' : 'var(--text-faint)',
                }}>
                  <TabletIcon size={24} />
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16, color: 'var(--text-strong)' }}>
                    {editingDevice.name || 'Tablet bez nazwy'}
                  </div>
                  <div style={{ marginTop: 5 }}>
                    <StatusBadge tone={editBadge.tone}>{editBadge.label}</StatusBadge>
                  </div>
                </div>
              </div>

              <Field label="Nazwa urządzenia">
                <input
                  type="text" style={inputStyle}
                  value={editingDevice.name}
                  onChange={e => setEditingDevice({ ...editingDevice, name: e.target.value })}
                  placeholder="np. Tablet Rejestracja"
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                />
              </Field>

              {editingDevice.pairing_token && (
                <Field label="Token parowania (Konfiguracja kiosku w apce mobilnej)">
                  <TokenField token={editingDevice.pairing_token} />
                  <button
                    onClick={() => handleResetPairing(editingDevice)}
                    style={{ ...btnSecondary, marginTop: 8, width: '100%', color: 'var(--red-600)', borderColor: 'var(--red-100)' }}
                  >
                    Resetuj token parowania
                  </button>
                  <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
                    Wyloguje obecnie sparowane urządzenie — trzeba będzie wpisać nowy token ręcznie.
                  </p>
                </Field>
              )}

              <Field label="Przypisana lokalizacja">
                <Select
                  value={editingDevice.location_id !== null ? String(editingDevice.location_id) : ''}
                  disabled={!editingDevice.is_active}
                  onChange={v => setEditingDevice({ ...editingDevice, location_id: v ? Number(v) : null })}
                  placeholder="Nieprzypisany do żadnej lokalizacji"
                  options={[
                    { value: '', label: 'Nieprzypisany do żadnej lokalizacji' },
                    ...sortByName(locations.filter(loc => loc.is_active), l => l.name).map(loc => {
                      const occupant = devices.find(d => d.location_id === loc.id && d.id !== editingDevice.id);
                      return {
                        value: String(loc.id),
                        label: `${loc.name}${occupant ? ` (zastąpi: ${occupant.name || 'tablet bez nazwy'})` : ''}`,
                      };
                    }),
                  ]}
                />
                {!editingDevice.is_active && (
                  <p style={{ fontFamily: 'var(--font-ui)', fontSize: 12.5, color: 'var(--text-faint)', margin: '6px 0 0' }}>
                    Aktywuj tablet, aby przypisać go do lokalizacji.
                  </p>
                )}
              </Field>
            </div>
          );
        })()}
      </SlidePanel>
    </div>
  );
});

export default AdminDashboard;
