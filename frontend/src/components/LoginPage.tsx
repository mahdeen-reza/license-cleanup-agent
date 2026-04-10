import { useState } from 'react';

interface Props {
  onLogin: (token: string) => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body: Record<string, string> = { email, password };
    if (mode === 'register') body.name = name;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Authentication failed.');
        return;
      }
      onLogin(data.token);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#292929',
    }}>
      <div className="card" style={{ maxWidth: 400, width: '100%', padding: '40px 32px' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#7c93c3', display: 'block', marginBottom: 8, textAlign: 'center' }}>
          SaaS License Clean-Up Agent
        </span>
        <p style={{ fontSize: 12, color: '#a0a0a0', textAlign: 'center', marginBottom: 28 }}>
          {mode === 'login' ? 'Sign in to continue' : 'Create an account'}
        </p>

        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="name">Name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={{ width: '100%' }}
              />
            </div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={{ width: '100%' }}
            />
          </div>

          {error && (
            <div className="error" style={{ marginBottom: 16, fontSize: 13 }}>{error}</div>
          )}

          <button
            type="submit"
            className="primary"
            disabled={loading}
            style={{ width: '100%', padding: '8px 12px', fontSize: 14 }}
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button
            style={{ background: 'none', border: 'none', color: '#7c93c3', fontSize: 12, textDecoration: 'underline' }}
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
          >
            {mode === 'login' ? 'Create an account' : 'Already have an account? Sign in'}
          </button>
        </div>

        <div style={{ marginTop: 24, padding: '12px', background: '#2a2a2a', borderRadius: 4, fontSize: 11, color: '#888' }}>
          <strong style={{ color: '#a0a0a0' }}>Demo credentials:</strong><br />
          admin@company.com / changeme123<br />
          analyst@company.com / demo123
        </div>
      </div>
    </div>
  );
}
