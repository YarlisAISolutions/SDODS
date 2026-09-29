import { useState, type FormEvent } from 'react';
import { SdodsLockup } from '../components/sdods-mark';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { Button, Field, Input } from '../components/ui';
import { cliInstallUrl } from '../lib/utils';

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel w-full max-w-sm p-6">
        <SdodsLockup className="h-12" />
        <h1 className="mb-4 text-center text-base font-semibold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      nav(params.get('next') ?? '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame title="Sign in">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Username">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        {error && <div className="text-xs text-red-500">{error}</div>}
        <Button variant="primary" className="w-full justify-center" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="muted text-center text-[11px]">
          No account yet? Ask an admin, or run <code>sdods users create</code>.
        </p>
        <p className="muted text-center text-[11px]">
          No <code>sdods</code> command yet?{' '}
          <a href={cliInstallUrl()} target="_blank" rel="noreferrer" className="underline">
            Install the SDODS CLI
          </a>
        </p>
      </form>
    </Frame>
  );
}

export function SetupPage() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('My organization');
  const [error, setError] = useState<string | null>(null);
  // Reaching this page by redirect carries no query string, so the token has to be enterable by
  // hand -- it is printed in the `sdods serve` output the user still has on screen.
  const urlToken = params.get('token');
  const [token, setToken] = useState(urlToken ?? '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/auth/setup', {
        json: { token, username, password, organization: orgName },
      });
      await refresh();
      nav('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Frame title="Create the first admin">
      <form onSubmit={submit} className="space-y-3">
        {!urlToken && (
          <Field
            label="Setup token"
            hint="Printed by `sdods serve` on first run. Restart it to print a new one."
          >
            <Input value={token} onChange={(e) => setToken(e.target.value)} autoFocus required />
          </Field>
        )}
        <Field
          label="Organization name"
          hint="You become its owner. You can add workspaces and members afterwards."
        >
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
        </Field>
        <Field label="Admin username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        {error && <div className="text-xs text-red-500">{error}</div>}
        <Button variant="primary" className="w-full justify-center">
          Create admin and continue
        </Button>
      </form>
    </Frame>
  );
}
