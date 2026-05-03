'use client';

import { useEffect, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
   /casters — Caster query tool
   Login + dashboard de plantillas predefinidas.
   ═══════════════════════════════════════════════════════════════════════════ */

interface User {
  id: number;
  username: string;
  display_name: string | null;
}

interface ParamDef {
  name: string;
  type: 'string' | 'int' | 'enum';
  label: string;
  values?: readonly string[];
  hint?: string;
}

interface Template {
  id: string;
  label: string;
  description: string;
  category: string;
  params: readonly ParamDef[];
}

export default function CastersClient() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Comprueba si ya hay sesión al cargar
  useEffect(() => {
    fetch('/api/casters/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.user) setUser(d.user); })
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return (
      <div className="cs-page">
        <div className="cs-loading">Cargando…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm onLogin={setUser} />;
  }

  return <Dashboard user={user} onLogout={() => setUser(null)} />;
}

/* ─────────────────────────────────────────────────────────────────────────── */

function LoginForm({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/casters/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de login');
      onLogin(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cs-page">
      <div className="cs-login-wrap">
        <form onSubmit={submit} className="cs-login-card">
          <h1 className="cs-login-title">CASTERS</h1>
          <p className="cs-login-sub">Acceso privado</p>

          <label className="cs-field">
            <span className="cs-field-label">Usuario</span>
            <input
              className="cs-input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase())}
              required
              autoFocus
            />
          </label>

          <label className="cs-field">
            <span className="cs-field-label">Contraseña</span>
            <input
              className="cs-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <div className="cs-error">{error}</div>}

          <button type="submit" className="cs-btn-primary" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/casters/templates')
      .then(r => r.json())
      .then(d => {
        setTemplates(d.templates || []);
        if (d.templates?.[0]) setSelectedId(d.templates[0].id);
      });
  }, []);

  const logout = async () => {
    await fetch('/api/casters/logout', { method: 'POST' });
    onLogout();
  };

  const selected = templates.find(t => t.id === selectedId);

  return (
    <div className="cs-page cs-dashboard">
      <header className="cs-header">
        <div className="cs-header-left">
          <span className="cs-brand">LEAGUESCOPE</span>
          <span className="cs-brand-divider">·</span>
          <span className="cs-brand-section">CASTERS</span>
        </div>
        <div className="cs-header-right">
          <span className="cs-user">{user.display_name || user.username}</span>
          <button className="cs-btn-link" onClick={logout}>Salir</button>
        </div>
      </header>

      <div className="cs-body">
        <aside className="cs-sidebar">
          <span className="cs-sidebar-title">PLANTILLAS</span>
          {templates.length === 0 && (
            <div className="cs-sidebar-empty">Cargando plantillas…</div>
          )}
          {templates.map(t => (
            <button
              key={t.id}
              className={`cs-tpl-item ${t.id === selectedId ? 'cs-tpl-active' : ''}`}
              onClick={() => setSelectedId(t.id)}
            >
              <span className="cs-tpl-cat">{t.category}</span>
              <span className="cs-tpl-label">{t.label}</span>
            </button>
          ))}
        </aside>

        <main className="cs-main">
          {selected ? <TemplateRunner template={selected} /> : (
            <div className="cs-empty">Selecciona una plantilla</div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function TemplateRunner({ template }: { template: Template }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state cuando cambia el template
  useEffect(() => {
    setValues({});
    setResult(null);
    setError(null);
  }, [template.id]);

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/casters/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, params: values }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error ejecutando');
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="cs-runner">
      <div className="cs-runner-header">
        <h2 className="cs-runner-title">{template.label}</h2>
        <p className="cs-runner-desc">{template.description}</p>
      </div>

      <form onSubmit={run} className="cs-form">
        {template.params.map(p => (
          <label key={p.name} className="cs-field">
            <span className="cs-field-label">{p.label}</span>
            {p.type === 'enum' && p.values ? (
              <select
                className="cs-input"
                value={values[p.name] || ''}
                onChange={e => setValues({ ...values, [p.name]: e.target.value })}
                required
              >
                <option value="">— Selecciona —</option>
                {p.values.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
              </select>
            ) : (
              <input
                className="cs-input"
                type={p.type === 'int' ? 'number' : 'text'}
                value={values[p.name] || ''}
                onChange={e => setValues({ ...values, [p.name]: e.target.value })}
                placeholder={p.hint}
                required
              />
            )}
          </label>
        ))}
        <button type="submit" className="cs-btn-primary" disabled={running}>
          {running ? 'Ejecutando…' : 'Ejecutar'}
        </button>
      </form>

      {error && <div className="cs-error">{error}</div>}
      {result != null && <ResultCard data={result} />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function ResultCard({ data }: { data: unknown }) {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    return (
      <div className="cs-result">
        <div className="cs-result-grid">
          {Object.entries(obj).map(([k, v]) => (
            <div key={k} className="cs-result-row">
              <span className="cs-result-key">{k}</span>
              <span className="cs-result-val">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return <pre className="cs-result-raw">{JSON.stringify(data, null, 2)}</pre>;
}
