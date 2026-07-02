import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import LoginForm from './components/LoginForm';
import AdminHome from './components/AdminHome';
import AdminDashboard from './components/AdminDashboard';
import AdminLocations from './components/AdminLocations';
import AdminUsers from './components/AdminUsers';
import AdminSettings from './components/AdminSettings';
import Sidebar from './components/Sidebar';
import UserSidebar from './components/UserSidebar';
import UserHome from './components/UserHome';
import UserQueue from './components/UserQueue';
import { api, getToken, clearToken } from './lib/api';
import type { MeResponse } from './lib/apiTypes';

type Role = 'admin' | 'user' | null;
type Theme = 'light' | 'dark';

/** Sesja wyprowadzona z /auth/me — jedyne trwałe dane to sam token JWT. */
interface Session {
  role: Role;
  fullName: string;
  locationIds: number[];
}

function meToSession(me: MeResponse): Session {
  return {
    role: me.role === 'ADMIN' ? 'admin' : 'user',
    fullName: me.full_name,
    locationIds: me.location_ids,
  };
}

const TAB_META: Record<string, { title: string; action: string | null }> = {
  strona_glowna: { title: 'Pulpit',      action: null },
  tablety:       { title: 'Tablety',     action: 'Dodaj urządzenie' },
  lokalizacje:   { title: 'Lokalizacje', action: 'Dodaj lokalizację' },
  uzytkownicy:   { title: 'Użytkownicy', action: 'Dodaj użytkownika' },
  ustawienia:    { title: 'Ustawienia',  action: null },
  kolejka:       { title: 'Kolejka na żywo', action: null },
};

const SEARCHABLE_TABS = new Set(['tablety', 'lokalizacje', 'uzytkownicy']);

/* ── header icon buttons ───────────────────────────────── */

function RefreshButton({ onClick, spinning }: { onClick: () => void; spinning: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={spinning}
      title="Odśwież"
      aria-label="Odśwież"
      style={{
        width: 40, height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: '1.5px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', color: 'var(--text-body)',
        cursor: spinning ? 'default' : 'pointer', opacity: spinning ? 0.6 : 1,
        transition: 'background var(--dur-fast), opacity var(--dur-fast)',
      }}
      onMouseEnter={e => { if (!spinning) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
    >
      <svg
        width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{ animation: spinning ? 'eque-spin 0.7s linear infinite' : 'none' }}
      >
        <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
      </svg>
    </button>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => { if (!value) setOpen(false); };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 40,
      width: open ? 240 : 40,
      border: `1.5px solid ${open ? 'var(--border-default)' : 'transparent'}`,
      borderRadius: 'var(--radius-md)',
      background: open ? 'var(--surface-card)' : 'transparent',
      overflow: 'hidden', flexShrink: 0,
      transition: 'width 240ms var(--ease-out), border-color 240ms var(--ease-out), background 240ms var(--ease-out)',
    }}>
      <button
        onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        title="Szukaj"
        aria-label="Szukaj"
        style={{
          width: 40, height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-body)', padding: 0,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={close}
        onKeyDown={e => {
          if (e.key === 'Escape') { onChange(''); inputRef.current?.blur(); }
        }}
        placeholder="Szukaj po nazwie…"
        style={{
          width: open ? 190 : 0, opacity: open ? 1 : 0,
          border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-strong)',
          padding: 0, marginRight: open ? 12 : 0,
          transition: 'width 240ms var(--ease-out), opacity 180ms var(--ease-out)',
        }}
      />
    </div>
  );
}

function AddIconButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        width: 40, height: 40, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--brand)', color: '#fff', border: 'none',
        borderRadius: 'var(--radius-md)', cursor: 'pointer',
        transition: 'background var(--dur-fast)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--brand-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}

function RefreshOverlay() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '120px 0' }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%',
        border: '3.5px solid var(--border-subtle)', borderTopColor: 'var(--brand)',
        animation: 'eque-spin 0.7s linear infinite',
      }} />
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Odświeżanie…</p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [activeTab, setActiveTab] = useState<string>('strona_glowna');
  const [addOpen, setAddOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [contentKey, setContentKey] = useState(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem('eque_theme') as Theme) || 'light';
  });

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('eque_theme', theme);
  }, [theme]);

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);

  // Sesja żyje wyłącznie w pamięci — jedyne co przetrwa przeładowanie strony
  // to sam token JWT w localStorage. Rola/imię/lokalizacje są za każdym razem
  // pobierane na nowo z serwera, żeby front nie ufał temu, co sam sobie zapisał.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setCheckingSession(false);
      return;
    }
    api.get<MeResponse>('/auth/me')
      .then(me => setSession(meToSession(me)))
      .catch(() => clearToken())
      .finally(() => setCheckingSession(false));
  }, []);

  const handleLoginSuccess = (me: MeResponse) => {
    setSession(meToSession(me));
    setActiveTab('strona_glowna');
  };

  const handleLogout = () => {
    setSession(null);
    clearToken();
  };

  const switchTab = (tab: string) => {
    setActiveTab(tab);
    setAddOpen(false);
    setSearchQuery('');
  };

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    refreshTimer.current = setTimeout(() => {
      setRefreshing(false);
      setContentKey(k => k + 1);
    }, 1000);
  };

  if (checkingSession) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-page)' }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%',
          border: '3.5px solid var(--border-subtle)', borderTopColor: 'var(--brand)',
          animation: 'eque-spin 0.7s linear infinite',
        }} />
      </div>
    );
  }

  if (!session) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  const { role, fullName: userName, locationIds } = session;

  const meta = TAB_META[activeTab] ?? { title: activeTab, action: null };
  const showSearch = role === 'admin' && SEARCHABLE_TABS.has(activeTab);
  const showRefresh = activeTab !== 'ustawienia';

  const placeholder = (text: string) => (
    <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', padding: 32, boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)' }}>
      <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: 16, margin: 0 }}>{text}</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--surface-page)' }}>
      {role === 'admin' && (
        <Sidebar
          activeTab={activeTab}
          setActiveTab={switchTab}
          userName={userName}
          userRole="admin"
          onLogout={handleLogout}
        />
      )}
      {role === 'user' && (
        <UserSidebar
          activeTab={activeTab}
          setActiveTab={switchTab}
          userName={userName}
          onLogout={handleLogout}
        />
      )}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Sticky page header */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 20,
          background: 'var(--surface-card)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '22px 48px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30,
            color: 'var(--text-strong)', margin: 0, letterSpacing: '-0.02em',
          }}>
            {meta.title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {showSearch && <SearchBox key={activeTab} value={searchQuery} onChange={setSearchQuery} />}
            {showRefresh && <RefreshButton onClick={handleRefresh} spinning={refreshing} />}
            {meta.action && (
              <AddIconButton onClick={() => setAddOpen(true)} label={meta.action} />
            )}
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, padding: '40px 48px', overflowY: 'auto' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', width: '100%' }}>
            {refreshing ? <RefreshOverlay /> : (
              role === 'admin' ? (
                activeTab === 'strona_glowna' ? <AdminHome key={contentKey} userName={userName} />
                : activeTab === 'tablety'     ? <AdminDashboard key={contentKey} addOpen={addOpen} onAddClose={() => setAddOpen(false)} searchQuery={searchQuery} />
                : activeTab === 'lokalizacje' ? <AdminLocations key={contentKey} addOpen={addOpen} onAddClose={() => setAddOpen(false)} searchQuery={searchQuery} />
                : activeTab === 'uzytkownicy' ? <AdminUsers key={contentKey} addOpen={addOpen} onAddClose={() => setAddOpen(false)} searchQuery={searchQuery} />
                : activeTab === 'ustawienia'  ? <AdminSettings theme={theme} onThemeChange={setTheme} />
                : placeholder('Pusta zakładka')
              ) : role === 'user' ? (
                activeTab === 'strona_glowna' ? <UserHome key={contentKey} userName={userName} locationIds={locationIds} />
                : activeTab === 'kolejka'     ? <UserQueue key={contentKey} userName={userName} locationIds={locationIds} />
                : activeTab === 'ustawienia'  ? <AdminSettings theme={theme} onThemeChange={setTheme} />
                : placeholder('Pusta zakładka')
              ) : null
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
