import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { alertDialog } from '../lib/dialog-actions';

type Theme = 'light' | 'dark';

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ThemeSwatch({ variant }: { variant: Theme }) {
  const dark = variant === 'dark';
  const page = dark ? '#0F1417' : '#F6F8F9';
  const card = dark ? '#171F24' : '#FFFFFF';
  const border = dark ? '#2A343C' : '#DDE4E8';
  const text = dark ? '#CBD3D8' : '#4C5961';
  const accent = '#0FB5AB';

  return (
    <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: `1px solid ${border}`, background: page, padding: 10, display: 'flex', gap: 8 }}>
      <div style={{ width: 22, flexShrink: 0, borderRadius: 4, background: card, display: 'flex', flexDirection: 'column', gap: 4, padding: 4 }}>
        <div style={{ width: 10, height: 10, borderRadius: 3, background: accent }} />
        <div style={{ width: '100%', height: 3, borderRadius: 2, background: border }} />
        <div style={{ width: '100%', height: 3, borderRadius: 2, background: border }} />
      </div>
      <div style={{ flex: 1, borderRadius: 4, background: card, padding: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ width: '60%', height: 4, borderRadius: 2, background: text }} />
        <div style={{ width: '85%', height: 3, borderRadius: 2, background: border }} />
        <div style={{ width: '40%', height: 3, borderRadius: 2, background: border }} />
      </div>
    </div>
  );
}

function ThemeOption({ value, label, description, icon, selected, onClick }: {
  value: Theme; label: string; description: string; icon: React.ReactNode; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left',
        padding: 16, borderRadius: 'var(--radius-md)', cursor: 'pointer',
        background: 'var(--surface-card)',
        border: `2px solid ${selected ? 'var(--brand)' : 'var(--border-subtle)'}`,
        transition: 'border-color var(--dur-fast) var(--ease-out)',
      }}
    >
      <ThemeSwatch variant={value} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'flex', color: selected ? 'var(--text-brand)' : 'var(--text-faint)' }}>{icon}</span>
          <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 15, color: 'var(--text-strong)' }}>{label}</span>
        </span>
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: selected ? 'var(--brand)' : 'transparent',
          border: `1.5px solid ${selected ? 'var(--brand)' : 'var(--border-default)'}`,
          color: '#fff',
        }}>
          {selected && <CheckIcon />}
        </span>
      </div>
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
        {description}
      </p>
    </button>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1.5px solid var(--border-default)',
  borderRadius: 'var(--radius-md)', padding: '11px 14px',
  fontFamily: 'var(--font-ui)', fontSize: 15,
  color: 'var(--text-strong)', background: 'var(--surface-card)',
  outline: 'none', boxSizing: 'border-box',
  transition: 'border-color var(--dur-fast)',
};
const labelStyle: React.CSSProperties = {
  display: 'block', marginBottom: 7,
  fontFamily: 'var(--font-ui)', fontSize: 14, fontWeight: 600,
  color: 'var(--text-body)',
};

function PasswordField({ label, value, onChange, autoComplete }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        type="password" style={inputStyle} value={value} autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
      />
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 6;
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSuccess(false);
    try {
      await api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err) {
      alertDialog(err instanceof ApiError ? err.message : 'Nie udało się zmienić hasła.', { title: 'Błąd', tone: 'danger' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ display: 'flex', color: 'var(--text-brand)' }}><LockIcon /></span>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--text-strong)', margin: 0 }}>
          Hasło i bezpieczeństwo
        </h2>
      </div>
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)', margin: '0 0 20px' }}>
        Zmień hasło używane do logowania na to konto.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PasswordField label="Obecne hasło" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
        <PasswordField label="Nowe hasło" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
        <PasswordField label="Powtórz nowe hasło" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

        {tooShort && (
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--amber-600)', margin: 0 }}>
            Nowe hasło musi mieć co najmniej 6 znaków.
          </p>
        )}
        {mismatch && (
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13, color: 'var(--red-600)', margin: 0 }}>
            Hasła nie są identyczne.
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 4 }}>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              background: 'var(--brand)', color: 'var(--on-brand)', border: 'none',
              borderRadius: 'var(--radius-md)', padding: '10px 22px',
              fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 14.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed', opacity: canSubmit ? 1 : 0.55,
              transition: 'background var(--dur-fast), opacity var(--dur-fast)',
            }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = 'var(--brand-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--brand)'; }}
          >
            {submitting ? 'Zapisywanie…' : 'Zmień hasło'}
          </button>

          <span style={{
            display: 'flex', alignItems: 'center', gap: 7,
            color: 'var(--green-600)', fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: 13.5,
            opacity: success ? 1 : 0, transform: success ? 'translateY(0)' : 'translateY(-4px)',
            transition: 'opacity 220ms var(--ease-out), transform 220ms var(--ease-out)',
          }}>
            <CheckCircleIcon /> Hasło zostało zmienione
          </span>
        </div>
      </form>
    </div>
  );
}

export default function AdminSettings({ theme, onThemeChange }: { theme: Theme; onThemeChange: (t: Theme) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 620 }}>
      <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-subtle)', padding: 28 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--text-strong)', margin: '0 0 4px' }}>
          Motyw aplikacji
        </h2>
        <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)', margin: '0 0 20px' }}>
          Wybierz wygląd aplikacji eQue.
        </p>

        <div style={{ display: 'flex', gap: 14 }}>
          <ThemeOption
            value="light"
            label="Jasny"
            description="Domyślny, jasny wygląd interfejsu."
            icon={<SunIcon />}
            selected={theme === 'light'}
            onClick={() => onThemeChange('light')}
          />
          <ThemeOption
            value="dark"
            label="Ciemny"
            description="Ciemne tło, mniej zmęczenia oczu wieczorem."
            icon={<MoonIcon />}
            selected={theme === 'dark'}
            onClick={() => onThemeChange('dark')}
          />
        </div>
      </div>

      <ChangePasswordCard />
    </div>
  );
}
