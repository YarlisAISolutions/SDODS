import { useEffect, useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@sdods/contracts/names';
import {
  useChangePassword,
  useMySessions,
  useProjects,
  useRevokeOtherSessions,
  useRevokeSession,
  useUpdateProfile,
} from '../../api/queries';
import type { MySession } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  RoleBadge,
  Select,
  SkeletonList,
} from '../../components/ui';
import { Avatar } from '../../components/ui/Avatar';
import { useToast } from '../../components/ui/Toast';
import { readProjectPref, writeProjectPref } from '../../lib/project-pref';
import { readThemePref, setThemePref, THEME_PREFS, type ThemePref } from '../../lib/theme';
import { cn, fmtDate, fmtRelative } from '../../lib/utils';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Profile ───────────────────────────────────────────────────────────────
export function ProfileTab() {
  const { me, refresh } = useAuth();
  const ws = useWorkspace();
  const { toast } = useToast();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState(me?.user.displayName ?? '');
  const [email, setEmail] = useState(me?.user.email ?? '');
  useEffect(() => {
    setDisplayName(me?.user.displayName ?? '');
    setEmail(me?.user.email ?? '');
  }, [me?.user.displayName, me?.user.email]);
  if (!me) return null;
  const { username, role, lastLoginAt, createdAt } = me.user;

  const emailError = email.trim() && !EMAIL.test(email.trim()) ? 'Not a valid email address.' : '';
  const dirty =
    displayName.trim() !== (me.user.displayName ?? '') || email.trim() !== (me.user.email ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || emailError) return;
    update.mutate(
      { displayName: displayName.trim() || null, email: email.trim() || null },
      {
        onSuccess: async () => {
          await refresh();
          toast('Profile saved', 'success');
        },
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card title="Profile">
        <form onSubmit={submit} className="space-y-3" aria-label="Profile">
          <div className="flex items-center gap-3">
            <Avatar name={displayName.trim() || username} seed={username} size="lg" />
            <div>
              <div className="text-base font-semibold">{displayName.trim() || username}</div>
              <div className="muted text-xs">@{username}</div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name" hint="Shown in the sidebar and on runs you start.">
              <Input
                value={displayName}
                maxLength={80}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={username}
              />
            </Field>
            <Field label="Email" error={emailError}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="Username" hint="Used to sign in. An admin can change it with the CLI.">
              <Input value={username} readOnly disabled />
            </Field>
          </div>
          {update.error && <ErrorBox error={update.error} />}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              disabled={!dirty || update.isPending}
              onClick={() => {
                setDisplayName(me.user.displayName ?? '');
                setEmail(me.user.email ?? '');
              }}
            >
              Reset
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!dirty || Boolean(emailError) || update.isPending}
            >
              {update.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      </Card>

      <div className="space-y-4">
        <Card title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="muted">Platform role</dt>
            <dd>
              <RoleBadge role={role} />
            </dd>
            <dt className="muted">Last sign-in</dt>
            <dd title={fmtDate(lastLoginAt)}>{fmtRelative(lastLoginAt)}</dd>
            <dt className="muted">Member since</dt>
            <dd>{fmtDate(createdAt)}</dd>
          </dl>
          {role === 'viewer' && (
            <p className="muted mt-3 text-xs">
              Viewers can read everything they are a member of. Ask an admin for editor access, or
              run <code className="mono">sdods users set-role {username} editor</code>.
            </p>
          )}
        </Card>
        <Card title="Memberships">
          {ws.loading ? (
            <SkeletonList rows={2} className="p-0" />
          ) : (
            <ul className="space-y-2 text-sm">
              {ws.orgs.map((o) => (
                <li key={o.slug} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {o.name} <span className="muted text-xs">organization</span>
                  </span>
                  <RoleBadge role={o.myRole} />
                </li>
              ))}
              {ws.workspaces.map((w) => (
                <li key={w.slug} className="flex items-center justify-between gap-2 pl-3">
                  <span className="truncate">{w.name}</span>
                  <RoleBadge role={w.myRole} />
                </li>
              ))}
              {!ws.orgs.length && <li className="muted text-xs">No memberships yet.</li>}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Security: password + sessions ─────────────────────────────────────────
export function SecurityTab() {
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <PasswordCard />
      <SessionsCard />
    </div>
  );
}

/** Rough strength for feedback only; the server enforces the minimum length. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < MIN_PASSWORD_LENGTH) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 16 || (pw.length >= 12 && classes >= 3)) return 3;
  return classes >= 2 ? 2 : 1;
}

export function validatePasswordForm(f: { current: string; next: string; confirm: string }) {
  const errors: { next?: string; confirm?: string } = {};
  if (f.next && f.next.length < MIN_PASSWORD_LENGTH)
    errors.next = `At least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (f.next && f.next === f.current) errors.next = 'Must differ from the current password.';
  if (f.confirm && f.confirm !== f.next) errors.confirm = 'Passwords do not match.';
  const valid = Boolean(f.current && f.next && f.confirm) && !errors.next && !errors.confirm;
  return { errors, valid };
}

function PasswordCard() {
  const { toast } = useToast();
  const change = useChangePassword();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const { errors, valid } = validatePasswordForm(form);
  const strength = passwordStrength(form.next);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    change.mutate(
      { currentPassword: form.current, newPassword: form.next },
      {
        onSuccess: (r) => {
          setForm({ current: '', next: '', confirm: '' });
          toast(
            r.otherSessionsSignedOut
              ? `Password changed. Signed out ${r.otherSessionsSignedOut} other session(s).`
              : 'Password changed.',
            'success',
          );
        },
      },
    );
  };

  return (
    <Card title="Change password">
      <form onSubmit={submit} className="space-y-3" aria-label="Change password">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={form.current}
            onChange={(e) => setForm({ ...form, current: e.target.value })}
          />
        </Field>
        <Field label="New password" error={errors.next}>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.next}
            onChange={(e) => setForm({ ...form, next: e.target.value })}
          />
        </Field>
        {form.next && (
          <div aria-label="Password strength" className="flex items-center gap-2">
            <div className="flex flex-1 gap-1">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cn(
                    'h-1 flex-1 rounded',
                    strength >= n
                      ? ['', 'bg-red-500', 'bg-amber-500', 'bg-green-500'][strength]
                      : 'bg-[var(--panel-2)]',
                  )}
                />
              ))}
            </div>
            <span className="muted text-[11px]">
              {['too short', 'weak', 'fair', 'strong'][strength]}
            </span>
          </div>
        )}
        <Field label="Confirm new password" error={errors.confirm}>
          <Input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          />
        </Field>
        {change.error && <ErrorBox error={change.error} />}
        <p className="muted text-xs">
          Changing your password signs you out everywhere else. This browser stays signed in.
        </p>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={!valid || change.isPending}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** "Chrome on macOS" from a user agent, without a parsing library. */
export function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /curl|node|undici|playwright/i.test(ua)
            ? 'Script'
            : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

function SessionsCard() {
  const { toast } = useToast();
  const q = useMySessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const sessions = q.data ?? [];
  const others = sessions.filter((s) => !s.current).length;

  return (
    <Card
      title="Active sessions"
      actions={
        <Button
          size="sm"
          variant="danger"
          disabled={!others || revokeOthers.isPending}
          onClick={() => setConfirmOthers(true)}
        >
          Sign out other sessions
        </Button>
      }
    >
      {q.isLoading && <SkeletonList rows={2} className="p-0" />}
      {q.error && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      <ul className="divide-y divide-[var(--border)]" aria-label="Sessions">
        {sessions.map((s: MySession) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {describeAgent(s.userAgent)}
                {s.current && <Badge tone="green">this browser</Badge>}
              </div>
              <div className="muted truncate text-xs" title={s.userAgent ?? ''}>
                {s.ip ?? 'unknown address'} · active {fmtRelative(s.lastSeenAt)} · signed in{' '}
                {fmtDate(s.createdAt)} · expires {fmtRelative(s.expiresAt)}
              </div>
            </div>
            {!s.current && (
              <Button
                size="sm"
                disabled={revoke.isPending}
                onClick={() =>
                  revoke.mutate(s.id, {
                    onSuccess: () => toast('Session signed out', 'success'),
                    onError: (e) => toast((e as Error).message, 'error'),
                  })
                }
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title="Sign out other sessions?"
        description={`Ends ${others} session(s) on other browsers and devices. API tokens are not affected.`}
        confirmLabel="Sign out others"
        pending={revokeOthers.isPending}
        error={revokeOthers.error}
        onConfirm={() =>
          revokeOthers.mutate(undefined, {
            onSuccess: (r) => {
              setConfirmOthers(false);
              toast(`Signed out ${r.revoked} session(s)`, 'success');
            },
          })
        }
      />
    </Card>
  );
}

// ── Preferences ───────────────────────────────────────────────────────────
const THEME_COPY: Record<ThemePref, { label: string; hint: string }> = {
  system: { label: 'System', hint: 'Follow the operating system' },
  light: { label: 'Light', hint: 'Always light' },
  dark: { label: 'Dark', hint: 'Always dark' },
};

export function PreferencesTab() {
  const ws = useWorkspace();
  const { toast } = useToast();
  const projects = useProjects(ws.workspace?.slug).data ?? [];
  const [theme, setTheme] = useState<ThemePref>(() => readThemePref());
  const [project, setProject] = useState<string>(() => readProjectPref() ?? '');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
          {THEME_PREFS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => {
                setTheme(t);
                setThemePref(t);
              }}
              className={cn(
                'rounded-md border p-3 text-left hover:bg-[var(--panel-2)]',
                theme === t ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mb-2 block h-8 rounded border border-line',
                  t === 'light' && 'bg-white',
                  t === 'dark' && 'bg-slate-900',
                  t === 'system' && 'bg-gradient-to-r from-white to-slate-900',
                )}
              />
              <span className="block text-sm font-medium">{THEME_COPY[t].label}</span>
              <span className="muted block text-[11px]">{THEME_COPY[t].hint}</span>
            </button>
          ))}
        </div>
        <p className="muted mt-3 text-xs">Saved in this browser.</p>
      </Card>
      <Card title="Where the app opens">
        <div className="space-y-3">
          <Field label="Organization">
            <Select value={ws.org?.slug ?? ''} onChange={(e) => ws.setOrg(e.target.value)}>
              {ws.orgs.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Workspace">
            <Select
              value={ws.workspace?.slug ?? ''}
              onChange={(e) => ws.setWorkspace(e.target.value)}
            >
              {ws.workspaces.map((w) => (
                <option key={w.slug} value={w.slug}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project" hint="Used by the sidebar when the address does not name one.">
            <Select
              value={projects.some((p) => p.slug === project) ? project : ''}
              onChange={(e) => {
                setProject(e.target.value);
                writeProjectPref(e.target.value);
                toast('Default project saved', 'success');
              }}
            >
              <option value="">First project in the workspace</option>
              {projects.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
    </div>
  );
}
