import { useState } from 'react';
import { api, setToken, ApiError } from '../lib/api';
import type { MeResponse, TokenResponse } from '../lib/apiTypes';

interface LoginFormProps {
  onLoginSuccess: (me: MeResponse) => void;
}

export default function LoginForm({ onLoginSuccess }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const token = await api.post<TokenResponse>('/auth/login', { username, password });
      setToken(token.access_token);
      const me = await api.get<MeResponse>('/auth/me');
      onLoginSuccess(me);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nieprawidłowy login lub hasło.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-page)', padding: '16px' }}>
      <div style={{ display: 'flex', width: '100%', maxWidth: 960, alignItems: 'center', gap: 80 }}>

        <div style={{ flex: 1, display: 'none' }} className="lg:block">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <img src="/logo-mark.svg" width="52" height="52" alt="eQue" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 38, letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>
              eQue
            </span>
          </div>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 20, color: 'var(--text-body)', lineHeight: 1.5, maxWidth: 380 }}>
            Zarządzaj kolejkami w swojej placówce szybko i wygodnie.
          </p>
        </div>

        <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, justifyContent: 'center' }}>
            <img src="/logo-mark.svg" width="40" height="40" alt="eQue" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>
              eQue
            </span>
          </div>

          <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', padding: 32 }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--text-strong)', marginBottom: 6 }}>
              Zaloguj się
            </h2>
            <p style={{ fontFamily: 'var(--font-ui)', fontSize: 14, color: 'var(--text-muted)', marginBottom: 24 }}>
              Panel przeznaczony wyłącznie dla personelu.
            </p>

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-body)' }}>
                  Nazwa użytkownika
                </label>
                <input
                  type="text"
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  style={{
                    border: '1.5px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '11px 14px',
                    fontSize: 15,
                    fontFamily: 'var(--font-ui)',
                    color: 'var(--text-strong)',
                    background: 'var(--surface-card)',
                    outline: 'none',
                    transition: 'border-color var(--dur-fast)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, fontWeight: 600, color: 'var(--text-body)' }}>
                  Hasło
                </label>
                <input
                  type="password"
                  placeholder="admin123"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    border: '1.5px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '11px 14px',
                    fontSize: 15,
                    fontFamily: 'var(--font-ui)',
                    color: 'var(--text-strong)',
                    background: 'var(--surface-card)',
                    outline: 'none',
                    transition: 'border-color var(--dur-fast)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--focus-ring)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                />
              </div>

              {error && (
                <p style={{ fontFamily: 'var(--font-ui)', fontSize: 13.5, color: 'var(--red-500)', textAlign: 'center', margin: 0 }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 6,
                  background: loading ? 'var(--brand-hover)' : 'var(--brand)',
                  color: 'var(--on-brand)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  padding: '13px',
                  fontSize: 15.5,
                  fontFamily: 'var(--font-ui)',
                  fontWeight: 700,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'background var(--dur-fast) var(--ease-out)',
                }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = 'var(--brand-hover)'; }}
                onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = 'var(--brand)'; }}
              >
                {loading ? 'Logowanie…' : 'Zaloguj się'}
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  );
}
