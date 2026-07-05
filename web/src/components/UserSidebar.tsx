interface UserSidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  userName: string;
  onLogout: () => void;
}

const NAV = [
  {
    key: 'strona_glowna',
    label: 'Strona główna',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
  },
  {
    key: 'kolejka',
    label: 'Kolejka na żywo',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    key: 'ustawienia',
    label: 'Ustawienia',
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    ),
  },
];

function getInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

export default function UserSidebar({ activeTab, setActiveTab, userName, onLogout }: UserSidebarProps) {
  const initials = getInitials(userName);

  return (
    <aside style={{
      width: 280,
      flexShrink: 0,
      height: '100vh',
      background: 'var(--surface-card)',
      borderRight: '1px solid var(--border-subtle)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '26px 22px 20px' }}>
        <img src="/logo-mark.svg" width="36" height="36" alt="" />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 23, letterSpacing: '-0.01em', color: 'var(--text-strong)' }}>
          eQue
        </span>
      </div>

      {}
      <nav style={{ flex: 1, padding: '4px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map((item) => {
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '12px 16px', border: 'none', cursor: 'pointer',
                borderRadius: 'var(--radius-md)', textAlign: 'left', width: '100%',
                background: active ? 'var(--brand-subtle)' : 'transparent',
                color: active ? 'var(--text-brand)' : 'var(--text-body)',
                fontFamily: 'var(--font-ui)', fontSize: 16, fontWeight: active ? 700 : 600,
                transition: 'background var(--dur-fast) var(--ease-out)',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-sunken)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      {}
      <div style={{
        borderTop: '1px solid var(--border-subtle)',
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ position: 'relative', flexShrink: 0 }}>
          <span style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--brand-subtle-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13,
            color: 'var(--text-brand)',
          }}>
            {initials}
          </span>
          <span style={{
            position: 'absolute', right: -1, bottom: -1,
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--green-500)',
            border: '2px solid var(--surface-card)',
          }} />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13.5, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {userName}
          </div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'var(--text-muted)' }}>Użytkownik</div>
        </div>

        <button
          onClick={onLogout}
          title="Wyloguj"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-faint)', padding: 6, borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            transition: 'background var(--dur-fast), color var(--dur-fast)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-faint)'; }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>
      </div>
    </aside>
  );
}
