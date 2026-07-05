import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { api, ApiError } from '../lib/api';
import { ws } from '../lib/ws';
import { sortByName } from '../lib/sort';
import type { UserResponse, LocationResponse, Role, RefreshHandle } from '../lib/apiTypes';
import { confirmDialog, alertDialog } from '../lib/dialog-actions';
import Select from './ui/Select';

type OnlineStatus = 'online' | 'offline';


function getInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

const AVATAR_TONES = [
  { bg: 'var(--teal-100)',  fg: 'var(--teal-700)' },
  { bg: 'var(--amber-100)', fg: 'var(--amber-700)' },
  { bg: 'var(--blue-100)',  fg: 'var(--blue-600)' },
  { bg: 'var(--green-100)', fg: 'var(--green-700)' },
  { bg: 'var(--slate-200)', fg: 'var(--slate-700)' },
];

const STATUS_COLOR: Record<OnlineStatus, string> = {
  online:  'var(--green-500)',
  offline: 'var(--slate-400)',
};

const STATUS_LABEL: Record<OnlineStatus, string> = {
  online:  'Online',
  offline: 'Offline',
};


function Avatar({ name, status, active = true, size = 44 }: { name: string; status: OnlineStatus; active?: boolean; size?: number }) {
  const tone = active ? AVATAR_TONES[name.charCodeAt(0) % AVATAR_TONES.length] : { bg: 'var(--slate-100)', fg: 'var(--slate-400)' };
  const dotSize = Math.max(10, Math.round(size * 0.28));
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, opacity: active ? 1 : 0.7 }}>
      <span style={{
        width: size, height: size, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: tone.bg, color: tone.fg,
        fontFamily: 'var(--font-ui)', fontWeight: 700,
        fontSize: Math.round(size * 0.38), lineHeight: 1, userSelect: 'none',
      }}>
        {getInitials(name) || '?'}
      </span>
      <span style={{
        position: 'absolute', right: -1, bottom: -1,
        width: dotSize, height: dotSize, borderRadius: '50%',
        background: active ? STATUS_COLOR[status] : 'var(--slate-400)',
        border: '2px solid var(--surface-card)',
      }} />
    </span>
  );
}

function RoleBadge({ role, active = true }: { role: Role; active?: boolean }) {
  const isAdmin = role === 'ADMIN';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 12px', borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 13,
      background: !active ? 'var(--slate-100)' : isAdmin ? 'var(--teal-50)'  : 'var(--slate-100)',
      color:      !active ? 'var(--slate-400)' : isAdmin ? 'var(--teal-700)' : 'var(--slate-700)',
      border:     !active ? '1px solid var(--slate-200)' : isAdmin ? '1px solid var(--teal-200)' : '1px solid var(--slate-200)',
    }}>
      {isAdmin ? 'Administrator' : 'Operator'}
    </span>
  );
}

function StatusBadge({ tone, children }: { tone: 'success' | 'warning' | 'neutral'; children: React.ReactNode }) {
  const map = {
    success: { fg: 'var(--green-700)', bg: 'var(--green-50)', bd: 'var(--green-100)', dot: 'var(--green-600)' },
    warning: { fg: 'var(--amber-700)', bg: 'var(--amber-50)', bd: 'var(--amber-100)', dot: 'var(--amber-600)' },
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
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
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


const AdminUsers = forwardRef<RefreshHandle, { addOpen?: boolean; onAddClose?: () => void; searchQuery?: string; currentUserId?: string }>(function AdminUsers({ addOpen: addPanelOpen = false, onAddClose, searchQuery = '', currentUserId }, ref) {
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [locations, setLocations] = useState<LocationResponse[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const [u, l] = await Promise.all([
        api.get<UserResponse[]>('/admin/users'),
        api.get<LocationResponse[]>('/admin/locations'),
      ]);
      setUsers(u);
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
    const initial = setTimeout(refetch, 0);
    return () => clearTimeout(initial);
  }, [refetch]);

  useEffect(() => {
    const offPresence = ws.on('user.presence', msg => {
      const userId = msg.user_id as string;
      const online = msg.status === 'online';
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, online } : u));
    });
    const offCreated = ws.on('user.created', msg => {
      const user = msg.user as UserResponse;
      setUsers(prev => prev.some(u => u.id === user.id) ? prev : [...prev, user]);
    });
    const offUpdated = ws.on('user.updated', msg => {
      const user = msg.user as UserResponse;
      setUsers(prev => prev.map(u => u.id === user.id ? user : u));
    });
    const offDeleted = ws.on('user.deleted', msg => {
      const userId = msg.user_id as string;
      setUsers(prev => prev.filter(u => u.id !== userId));
    });
    return () => { offPresence(); offCreated(); offUpdated(); offDeleted(); };
  }, []);

  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newPosition, setNewPosition] = useState('');
  const [newRole, setNewRole] = useState<Role>('OPERATOR');
  const [newPassword, setNewPassword] = useState('');

  const [editUser, setEditUser] = useState<UserResponse | null>(null);
  const [editPasswordInput, setEditPasswordInput] = useState('');

  const openEdit = (user: UserResponse) => {
    setEditUser({ ...user });
    setEditPasswordInput('');
  };

  const resetAddForm = () => {
    setNewUsername(''); setNewFullName(''); setNewPosition(''); setNewRole('OPERATOR'); setNewPassword('');
  };

  const handleAdd = async () => {
    if (!newUsername.trim() || !newFullName.trim() || !newPassword) return;
    try {
      const created = await api.post<UserResponse>('/admin/users', {
        username: newUsername.trim(),
        full_name: newFullName.trim(),
        position: newPosition.trim() || null,
        role: newRole,
        password: newPassword,
        location_ids: [],
      });
      setUsers(prev => prev.some(u => u.id === created.id) ? prev : [...prev, created]);
      onAddClose?.();
      resetAddForm();
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się dodać użytkownika.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser) return;
    try {
      const updated = await api.put<UserResponse>(`/admin/users/${editUser.id}`, {
        username: editUser.username,
        full_name: editUser.full_name,
        position: editUser.position,
        role: editUser.role,
        password: editPasswordInput.trim() !== '' ? editPasswordInput : undefined,
        location_ids: editUser.location_ids,
      });
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
      setEditUser(null);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zapisać zmian.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleDelete = async () => {
    if (!editUser) return;
    if (!(await confirmDialog(`Usunąć użytkownika "${editUser.full_name}"?`, { title: 'Usuń użytkownika', tone: 'danger', confirmLabel: 'Usuń' }))) return;
    try {
      await api.del(`/admin/users/${editUser.id}`);
      setUsers(prev => prev.filter(u => u.id !== editUser.id));
      setEditUser(null);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się usunąć użytkownika.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const handleToggleActive = async (user: UserResponse) => {
    if (user.is_active) {
      const ok = await confirmDialog(
        `Czy na pewno chcesz dezaktywować konto "${user.full_name}"? Zostanie odłączone od przypisanych lokalizacji.`,
        { title: 'Dezaktywuj konto', tone: 'danger', confirmLabel: 'Dezaktywuj' }
      );
      if (!ok) return;
    }
    try {
      const updated = await api.post<UserResponse>(`/admin/users/${user.id}/${user.is_active ? 'deactivate' : 'activate'}`);
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zmienić statusu konta.', { title: 'Błąd', tone: 'danger' });
    }
  };

  const allLocationNames = (u: UserResponse) =>
    locations.filter(l => u.location_ids.includes(l.id)).map(l => l.name);

  const visibleUsers = sortByName(
    searchQuery.trim()
      ? users.filter(u => u.full_name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
      : users,
    u => u.full_name
  );

  return (
    <div>
      {}
      <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        {}
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1.4fr 0.9fr 1fr 96px',
          gap: 12, padding: '12px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-ui)', fontSize: 12, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)',
        }}>
          <span>Pracownik</span><span>Lokalizacja</span><span>Rola</span><span>Status</span><span></span>
        </div>

        {!loading && visibleUsers.length === 0 && (
          <div style={{ padding: 36, textAlign: 'center', fontFamily: 'var(--font-ui)', color: 'var(--text-muted)', fontSize: 15 }}>
            {users.length === 0 ? 'Brak dodanych pracowników.' : 'Brak pracowników pasujących do wyszukiwania.'}
          </div>
        )}

        {visibleUsers.map((user, i) => {
          const status: OnlineStatus = user.online ? 'online' : 'offline';
          const locNames = allLocationNames(user);
          const isAdmin = user.role === 'ADMIN';

          const badge = !user.is_active
            ? { tone: 'neutral' as const, label: 'Dezaktywowany' }
            : status === 'online' ? { tone: 'success' as const, label: 'Online' }
            : { tone: 'neutral' as const, label: 'Offline' };

          return (
            <div
              key={user.id}
              style={{
                display: 'grid', gridTemplateColumns: '2fr 1.4fr 0.9fr 1fr 96px',
                gap: 12, alignItems: 'center', padding: '17px 24px',
                background: user.is_active ? 'transparent' : 'var(--surface-sunken)',
                borderBottom: i < visibleUsers.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                transition: 'background var(--dur-base) var(--ease-out)',
              }}
            >
              {}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <Avatar name={user.full_name} status={status} active={user.is_active} size={44} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15.5, color: user.is_active ? 'var(--text-strong)' : 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {user.full_name}
                    </span>
                    {user.id === currentUserId && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                        padding: '2px 9px', borderRadius: 'var(--radius-pill)',
                        background: 'var(--brand-subtle)', border: '1px solid var(--brand-border)',
                        color: 'var(--text-brand)', fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 11.5,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                      }}>
                        Ty
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {user.position || `@${user.username}`}
                  </div>
                </div>
              </div>

              {}
              <div style={{ minWidth: 0 }}>
                {isAdmin ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--teal-600)',
                    fontStyle: 'italic',
                  }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    Dostęp globalny
                  </span>
                ) : locNames.length > 0 ? (() => {
                  const overflow = locNames.length > 2;
                  const visible = overflow ? locNames.slice(0, 1) : locNames;
                  const extra = overflow ? locNames.length - 1 : 0;
                  return (
                    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 5, alignItems: 'center', overflow: 'hidden' }}>
                      {visible.map(name => (
                        <span key={name} style={{
                          display: 'inline-block',
                          padding: '3px 9px',
                          background: 'var(--surface-sunken)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-md)',
                          fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600,
                          color: 'var(--text-body)',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          maxWidth: 130,
                        }}>
                          {name}
                        </span>
                      ))}
                      {extra > 0 && (
                        <span style={{
                          display: 'inline-block', flexShrink: 0,
                          padding: '3px 9px',
                          background: 'var(--brand-subtle)',
                          border: '1px solid var(--brand-border)',
                          borderRadius: 'var(--radius-md)',
                          fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 700,
                          color: 'var(--text-brand)',
                          whiteSpace: 'nowrap',
                        }}>
                          +{extra}
                        </span>
                      )}
                    </div>
                  );
                })() : (
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--text-faint)' }}>—</span>
                )}
              </div>

              {}
              <div><RoleBadge role={user.role} active={user.is_active} /></div>

              {}
              <div><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></div>

              {}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <Switch
                  checked={user.is_active}
                  onChange={() => handleToggleActive(user)}
                  ariaLabel={user.is_active ? `Dezaktywuj konto ${user.full_name}` : `Aktywuj konto ${user.full_name}`}
                />
                <button
                  onClick={() => openEdit(user)}
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
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {}
      <SlidePanel title="Nowy użytkownik" open={addPanelOpen} onClose={() => { onAddClose?.(); resetAddForm(); }} footer={
        <>
          <button style={btnPrimary} onClick={handleAdd}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}>
            Dodaj
          </button>
        </>
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Field label="Imię i nazwisko">
            <input style={inputStyle} type="text" value={newFullName} onChange={e => setNewFullName(e.target.value)}
              placeholder="np. Anna Nowak"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
          </Field>
          <Field label="Nazwa użytkownika (login)">
            <input style={inputStyle} type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
              placeholder="np. anna.nowak"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
          </Field>
          <Field label="Stanowisko (opcjonalnie)">
            <input style={inputStyle} type="text" value={newPosition} onChange={e => setNewPosition(e.target.value)}
              placeholder="np. Recepcjonistka"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
          </Field>
          <Field label="Rola systemowa">
            <Select
              value={newRole}
              onChange={v => setNewRole(v as Role)}
              options={[
                { value: 'OPERATOR', label: 'Operator' },
                { value: 'ADMIN', label: 'Administrator' },
              ]}
            />
          </Field>
          <Field label="Hasło">
            <input style={inputStyle} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="Hasło do logowania"
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
          </Field>
        </div>
      </SlidePanel>

      {}
      <SlidePanel title="Edytuj użytkownika" open={!!editUser} onClose={() => setEditUser(null)} footer={
        <>
          <button style={btnDanger} onClick={handleDelete}>Usuń</button>
          <button style={{ ...btnPrimary, marginLeft: 'auto' }} onClick={handleSaveEdit}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}>
            Zapisz
          </button>
        </>
      }>
        {editUser && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)' }}>
              <Avatar name={editUser.full_name || '?'} status={editUser.online ? 'online' : 'offline'} active={editUser.is_active} size={48} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 16, color: editUser.is_active ? 'var(--text-strong)' : 'var(--text-faint)' }}>{editUser.full_name || '—'}</div>
                <div style={{ marginTop: 5 }}>
                  {editUser.is_active ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[editUser.online ? 'online' : 'offline'], display: 'inline-block' }} />
                      <span style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)' }}>
                        {STATUS_LABEL[editUser.online ? 'online' : 'offline']}
                      </span>
                    </div>
                  ) : (
                    <StatusBadge tone="neutral">Dezaktywowany</StatusBadge>
                  )}
                </div>
              </div>
            </div>

            <Field label="Imię i nazwisko">
              <input style={inputStyle} type="text" value={editUser.full_name}
                onChange={e => setEditUser({ ...editUser, full_name: e.target.value })}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
            </Field>

            <Field label="Nazwa użytkownika (login)">
              <input style={inputStyle} type="text" value={editUser.username}
                onChange={e => setEditUser({ ...editUser, username: e.target.value })}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
            </Field>

            <Field label="Stanowisko">
              <input style={inputStyle} type="text" value={editUser.position ?? ''}
                onChange={e => setEditUser({ ...editUser, position: e.target.value })}
                placeholder="np. Recepcjonistka"
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
            </Field>

            <Field label="Rola systemowa">
              <Select
                value={editUser.role}
                onChange={v => {
                  const role = v as Role;
                  setEditUser({
                    ...editUser,
                    role,
                    location_ids: role === 'ADMIN' ? [] : editUser.location_ids,
                  });
                }}
                options={[
                  { value: 'OPERATOR', label: 'Operator' },
                  { value: 'ADMIN', label: 'Administrator' },
                ]}
              />
            </Field>

            <Field label="Nowe hasło">
              <input style={inputStyle} type="password"
                value={editPasswordInput}
                onChange={e => setEditPasswordInput(e.target.value)}
                placeholder="Zostaw puste aby nie zmieniać"
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }} />
            </Field>

            {editUser.role === 'OPERATOR' && (() => {
              const assignableLocations = sortByName(locations.filter(l => l.is_active), l => l.name);
              return (
                <Field label="Przypisane lokalizacje">
                  {!editUser.is_active ? (
                    <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-faint)', margin: 0 }}>
                      Aktywuj konto, aby przypisać lokalizacje.
                    </p>
                  ) : (
                    <div style={{ border: '1.5px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                      {assignableLocations.map((loc, i) => (
                        <label key={loc.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 16px', cursor: 'pointer',
                          borderBottom: i < assignableLocations.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                          background: editUser.location_ids.includes(loc.id) ? 'var(--brand-subtle)' : 'transparent',
                        }}>
                          <input type="checkbox"
                            checked={editUser.location_ids.includes(loc.id)}
                            onChange={e => {
                              const ids = e.target.checked
                                ? [...editUser.location_ids, loc.id]
                                : editUser.location_ids.filter(id => id !== loc.id);
                              setEditUser({ ...editUser, location_ids: ids });
                            }}
                            style={{ accentColor: 'var(--brand)', width: 16, height: 16 }} />
                          <span style={{ fontFamily: 'var(--font-ui)', fontSize: 14.5, fontWeight: 600, color: 'var(--text-body)' }}>{loc.name}</span>
                        </label>
                      ))}
                      {assignableLocations.length === 0 && (
                        <div style={{ padding: 16, fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)' }}>Brak dostępnych lokalizacji</div>
                      )}
                    </div>
                  )}
                </Field>
              );
            })()}

            {editUser.role === 'ADMIN' && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', background: 'var(--teal-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--teal-200)' }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--teal-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--teal-700)', margin: 0, lineHeight: 1.5 }}>
                  Administratorzy mają dostęp globalny do wszystkich lokalizacji. Przypisanie do konkretnych lokalizacji nie dotyczy tej roli.
                </p>
              </div>
            )}
          </div>
        )}
      </SlidePanel>
    </div>
  );
});

export default AdminUsers;
