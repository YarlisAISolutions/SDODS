import { useState } from 'react';
import { useNavigate } from 'react-router';
import { SPONSOR_ENABLED, SPONSOR_URL } from '@sdods/contracts/sponsor';
import { useAuth } from '../auth/AuthContext';
import { readThemePref, setThemePref, THEME_PREFS, type ThemePref } from '../lib/theme';
import { RoleBadge } from './ui';
import { Avatar } from './ui/Avatar';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from './ui/Menu';

const THEME_LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/**
 * The account block at the foot of the sidebar: who is signed in, and everything about their own
 * account in one menu (profile, security, tokens, theme, sign out).
 */
export function UserMenu({ feedbackUrl }: { feedbackUrl: string }) {
  const { me, logout, isAdmin } = useAuth();
  const nav = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(() => readThemePref());
  if (!me) return null;
  const { username, displayName, email, role } = me.user;
  const shown = displayName || username;

  const signOut = () => {
    // Guard against a second click while the request is in flight: the first one has already
    // invalidated the session, and the second would race the redirect.
    if (signingOut) return;
    setSigningOut(true);
    void logout().finally(() => setSigningOut(false));
  };

  return (
    <Menu>
      <MenuTrigger
        data-testid="user-menu"
        aria-label={`Account menu for ${shown}`}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--panel-2)] data-[state=open]:bg-[var(--panel-2)]"
      >
        <Avatar name={shown} seed={username} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{shown}</span>
          <span className="flex items-center gap-1 text-[11px] muted">
            {displayName ? <span className="truncate">@{username}</span> : null}
            <RoleBadge role={role} />
          </span>
        </span>
        <span aria-hidden className="muted text-xs">
          ⌃
        </span>
      </MenuTrigger>
      <MenuContent side="top" align="start" className="w-[248px]">
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar name={shown} seed={username} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{shown}</div>
            <div className="truncate text-[11px] muted">{email || `@${username}`}</div>
          </div>
        </div>
        <MenuSeparator />
        <MenuLabel>Account</MenuLabel>
        <MenuItem onSelect={() => nav('/settings/profile')}>Profile</MenuItem>
        <MenuItem onSelect={() => nav('/settings/security')}>Password &amp; sessions</MenuItem>
        <MenuItem onSelect={() => nav('/settings/preferences')}>Preferences</MenuItem>
        <MenuSeparator />
        <MenuLabel>Developer</MenuLabel>
        <MenuItem onSelect={() => nav('/settings/tokens')}>API tokens</MenuItem>
        <MenuItem onSelect={() => nav('/settings/mcp')}>MCP clients</MenuItem>
        {isAdmin && (
          <>
            <MenuSeparator />
            <MenuLabel>Administration</MenuLabel>
            <MenuItem onSelect={() => nav('/users')}>Users</MenuItem>
            <MenuItem onSelect={() => nav('/workspaces')}>Organizations &amp; workspaces</MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuSub>
          <MenuSubTrigger>
            Theme <span className="muted ml-auto pr-1 text-[11px]">{THEME_LABEL[theme]}</span>
          </MenuSubTrigger>
          <MenuSubContent>
            <MenuRadioGroup
              value={theme}
              onValueChange={(v) => {
                setTheme(v as ThemePref);
                setThemePref(v as ThemePref);
              }}
            >
              {THEME_PREFS.map((t) => (
                <MenuRadioItem key={t} value={t}>
                  {THEME_LABEL[t]}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
        <MenuItem asChild>
          <a href={feedbackUrl} target="_blank" rel="noreferrer" data-testid="send-feedback">
            Send feedback ↗
          </a>
        </MenuItem>
        {SPONSOR_ENABLED && (
          <MenuItem asChild>
            <a href={SPONSOR_URL} target="_blank" rel="noreferrer" data-testid="sponsor-link">
              Sponsor SDODS ♥ ↗
            </a>
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem
          danger
          disabled={signingOut}
          // Keep the menu open until the redirect; closing first would flash the shell.
          onSelect={(e) => {
            e.preventDefault();
            signOut();
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
