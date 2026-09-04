import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './app-shell';
import { LoginPage, SetupPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { ProjectsPage } from './pages/Projects';
import { ProjectFormPage } from './pages/ProjectForm';
import { EnvironmentsPage } from './pages/Environments';
import { DatasetsPage } from './pages/Datasets';
import { UserPoolPage } from './pages/UserPool';
import { ProcessesPage } from './pages/Processes';
import { RunsPage } from './pages/Runs';
import { RunDetailPage } from './pages/RunDetail';
import { ScenarioPage } from './pages/run/ScenarioPage';
import { FeatureEditorPage } from './pages/FeatureEditor';
import { RecorderPage } from './pages/Recorder';
import { AgentsPage } from './pages/Agents';
import { IntegrationsPage } from './pages/Integrations';
import { SchedulesPage } from './pages/Schedules';
import { UsersPage } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { WorkspacesPage } from './pages/Workspaces';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/setup', element: <SetupPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/new', element: <ProjectFormPage /> },
      { path: 'projects/:slug', element: <Navigate to="edit" replace /> },
      { path: 'projects/:slug/edit', element: <ProjectFormPage /> },
      { path: 'projects/:slug/envs', element: <EnvironmentsPage /> },
      { path: 'projects/:slug/datasets', element: <DatasetsPage /> },
      { path: 'projects/:slug/pool', element: <UserPoolPage /> },
      { path: 'projects/:slug/processes', element: <ProcessesPage /> },
      { path: 'projects/:slug/editor', element: <FeatureEditorPage /> },
      { path: 'projects/:slug/editor/*', element: <FeatureEditorPage /> },
      { path: 'projects/:slug/recorder', element: <RecorderPage /> },
      { path: 'projects/:slug/integrations', element: <IntegrationsPage /> },
      { path: 'projects/:slug/schedules', element: <SchedulesPage /> },
      { path: 'runs', element: <RunsPage /> },
      { path: 'runs/:runId', element: <RunDetailPage /> },
      { path: 'runs/:runId/scenarios/:sid', element: <ScenarioPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'schedules', element: <SchedulesPage /> },
      { path: 'users', element: <UsersPage /> },
      { path: 'settings', element: <Navigate to="tokens" replace /> },
      { path: 'settings/:tab', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
