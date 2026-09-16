import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../api/types';

const admin: Me = {
  user: {
    id: 'u1',
    username: 'ada',
    displayName: 'Ada Lovelace',
    email: 'ada@example.com',
    role: 'admin',
    active: true,
  },
  csrfToken: 'x',
  scopes: [],
  orgRoles: {},
  workspaceRoles: {},
};
let currentMe: Me = admin;
const calls: string[] = [];

vi.mock('../api/client', async (orig) => {
  const mod = (await orig()) as object;
  return {
    ...mod,
    api: vi.fn(async (path: string) => {
      calls.push(path);
      if (path === '/api/auth/me') return currentMe;
      return { ok: true };
    }),
  };
});

import { AuthProvider } from '../auth/AuthContext';
import { UserMenu } from './UserMenu';
import { initials } from './ui/Avatar';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <UserMenu feedbackUrl="https://example.com/feedback" />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('UserMenu', () => {
  beforeEach(() => {
    calls.length = 0;
    localStorage.clear();
    currentMe = admin;
  });

  it('shows the display name and role, and navigates to the profile', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = await screen.findByTestId('user-menu');
    expect(trigger).toHaveTextContent('Ada Lovelace');
    expect(trigger).toHaveTextContent('admin');
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Profile' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/profile');
  });

  it('shows admin entries only to admins', async () => {
    const user = userEvent.setup();
    currentMe = { ...admin, user: { ...admin.user, role: 'viewer', displayName: undefined } };
    mount();
    const trigger = await screen.findByTestId('user-menu');
    expect(trigger).toHaveTextContent('ada');
    await user.click(trigger);
    await screen.findByRole('menuitem', { name: 'API tokens' });
    expect(screen.queryByRole('menuitem', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('signs out through the menu', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('user-menu'));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(calls).toContain('/api/auth/logout'));
  });

  it('switches the theme and remembers it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('user-menu'));
    await user.click(await screen.findByRole('menuitem', { name: /Theme/ }));
    // Radix selects on keyboard reliably in jsdom; pointer selection depends on layout events.
    (await screen.findByRole('menuitemradio', { name: 'Dark' })).focus();
    await user.keyboard('{Enter}');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('sdods:theme')).toBe('"dark"');
  });
});

describe('initials', () => {
  it('uses two words when there are two, else the first two letters', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada.lovelace')).toBe('AL');
    expect(initials('admin')).toBe('AD');
    expect(initials('')).toBe('?');
  });
});
