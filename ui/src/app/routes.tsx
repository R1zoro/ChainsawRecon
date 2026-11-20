import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ReadyStatePage } from '../features/ready-state/ReadyStatePage';
import { EngagementWizardPage } from '../features/engagement-wizard/EngagementWizardPage';
import { RoutePlaceholder } from '../components/common/RoutePlaceholder';

// Code-split routes: React Flow and heavyweight features are loaded on demand
const ProjectOverviewPage = React.lazy(() =>
  import('../features/app-model/ProjectOverviewPage').then((m) => ({ default: m.ProjectOverviewPage }))
);
const WorkbenchPage = React.lazy(() =>
  import('../features/workbench/WorkbenchPage').then((m) => ({ default: m.WorkbenchPage }))
);
const FindingsPage = React.lazy(() =>
  import('../features/findings/FindingsPage').then((m) => ({ default: m.FindingsPage }))
);
const ReportsPage = React.lazy(() =>
  import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const AuthProfilesPage = React.lazy(() =>
  import('../features/auth/AuthProfilesPage').then((m) => ({ default: m.AuthProfilesPage }))
);
const ModelsProvidersPage = React.lazy(() =>
  import('../features/models/ModelsProvidersPage').then((m) => ({ default: m.ModelsProvidersPage }))
);
const SessionWorkspacePage = React.lazy(() =>
  import('../features/sessions/SessionWorkspacePage').then((m) => ({ default: m.SessionWorkspacePage }))
);

const Suspended = ({ children }: { children: React.ReactNode }) => (
  <React.Suspense
    fallback={
      <div className="h-screen bg-bg text-text-muted flex items-center justify-center font-mono text-xs select-none">
        Loading module...
      </div>
    }
  >
    {children}
  </React.Suspense>
);

export const router = createBrowserRouter([
  {
    path: '/',
    element: <ReadyStatePage />,
  },
  {
    path: '/engagements/new',
    element: <EngagementWizardPage />,
  },
  {
    path: '/projects/:projectId',
    element: (
      <Suspended>
        <ProjectOverviewPage />
      </Suspended>
    ),
  },
  {
    path: '/projects/:projectId/findings',
    element: (
      <Suspended>
        <FindingsPage />
      </Suspended>
    ),
  },
  {
    path: '/projects/:projectId/findings/:findingId',
    element: (
      <Suspended>
        <FindingsPage />
      </Suspended>
    ),
  },
  {
    path: '/findings',
    element: (
      <Suspended>
        <FindingsPage />
      </Suspended>
    ),
  },
  {
    path: '/projects/:projectId/reports',
    element: (
      <Suspended>
        <ReportsPage />
      </Suspended>
    ),
  },
  {
    path: '/reports',
    element: (
      <Suspended>
        <ReportsPage />
      </Suspended>
    ),
  },
  {
    path: '/projects/:projectId/auth',
    element: (
      <Suspended>
        <AuthProfilesPage />
      </Suspended>
    ),
  },
  {
    path: '/projects/:projectId/workbench',
    element: (
      <Suspended>
        <WorkbenchPage />
      </Suspended>
    ),
  },
  {
    path: '/workbench',
    element: (
      <Suspended>
        <WorkbenchPage />
      </Suspended>
    ),
  },
  {
    path: '/projects/:projectId/oast',
    element: (
      <Suspended>
        <WorkbenchPage />
      </Suspended>
    ),
  },
  {
    path: '/oast',
    element: (
      <Suspended>
        <WorkbenchPage />
      </Suspended>
    ),
  },
  {
    path: '/sessions/:sessionId',
    element: (
      <Suspended>
        <SessionWorkspacePage />
      </Suspended>
    ),
  },
  {
    path: '/settings',
    element: (
      <RoutePlaceholder
        title="System & Security Settings"
        milestone="Milestone 5"
        description="Configure testing policies, local execution directories, ScopeGuard defaults, and rate-limiting limits."
      />
    ),
  },
  {
    path: '/models',
    element: (
      <Suspended>
        <ModelsProvidersPage />
      </Suspended>
    ),
  },
  {
    path: '/tools',
    element: (
      <RoutePlaceholder
        title="Security Tool Packs & Docker Sandbox"
        milestone="Milestone 5"
        description="Inspect and install security tool packs (httpx, katana, nuclei, ffuf, dalfox, sqlmap, inql)."
      />
    ),
  },
  {
    path: '/auth-profiles',
    element: (
      <Suspended>
        <AuthProfilesPage />
      </Suspended>
    ),
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
