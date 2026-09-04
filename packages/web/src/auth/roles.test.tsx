import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Me } from '../api/types';

const meViewer: Me = {
  user: { id: 'u3', username: 'viewer', role: 'viewer', active: true },
  csrfToken: 'x',
  scopes: ['projects:read', 'runs:read'],
  orgRoles: { sdods: 'member' },
  workspaceRoles: { default: 'viewer' },
};
const meEditor: Me = {
  ...meViewer,
  user: { ...meViewer.user, username: 'maria', role: 'editor' },
  scopes: ['projects:read', 'runs:read', 'runs:write', 'agents:run'],
  workspaceRoles: { default: 'editor' },
};

let currentMe: Me = meViewer;
vi.mock('../api/client', async (orig) => {
  const mod = (await orig()) as object;
  return {
    ...mod,
    api: vi.fn(async (path: string) => {
      if (path === '/api/auth/me') return currentMe;
      if (path === '/api/orgs')
        return [{ id: 'o1', slug: 'sdods', name: 'SDODS', myRole: currentMe.orgRoles.sdods }];
      if (path.startsWith('/api/workspaces'))
        return [
          {
            id: 'w1',
            organizationId: 'o1',
            slug: 'default',
            name: 'Default',
            projectCount: 1,
            myRole: currentMe.workspaceRoles.default,
          },
        ];
      if (path.startsWith('/api/projects')) return [];
      if (path.startsWith('/api/runs')) return { items: [], total: 0 };
      return [];
    }),
  };
});

import { AuthProvider } from './AuthContext';
import { WorkspaceProvider } from '../context/WorkspaceContext';
import { ToastProvider } from '../components/ui/Toast';
import { RunsPage } from '../pages/Runs';
import { ProjectsPage } from '../pages/Projects';

function mount(ui: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <MemoryRouter>{ui}</MemoryRouter>
          </WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('role gating', () => {
  beforeEach(() => localStorage.clear());

  it('hides Start run and New project from a viewer', async () => {
    currentMe = meViewer;
    mount(<RunsPage />);
    await screen.findByText(/runs in/i);
    expect(screen.queryByRole('button', { name: 'Start run' })).not.toBeInTheDocument();
    mount(<ProjectsPage />);
    await screen.findAllByText(/Projects/);
    expect(screen.queryByRole('button', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('shows Start run to an editor of the workspace', async () => {
    currentMe = meEditor;
    mount(<RunsPage />);
    expect(await screen.findByRole('button', { name: 'Start run' })).toBeInTheDocument();
  });
});
