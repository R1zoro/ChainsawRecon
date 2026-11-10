import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ReadyStatePage } from '../features/ready-state/ReadyStatePage';
import { EngagementWizardPage } from '../features/engagement-wizard/EngagementWizardPage';
import { SessionWorkspacePage } from '../features/sessions/SessionWorkspacePage';
import { ProjectOverviewPage } from '../features/app-model/ProjectOverviewPage';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { RoutePlaceholder } from '../components/common/RoutePlaceholder';

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
    element: <ProjectOverviewPage />,
  },
  {
    path: '/projects/:projectId/workbench',
    element: <WorkbenchPage />,
  },
  {
    path: '/workbench',
    element: <WorkbenchPage />,
  },
  {
    path: '/sessions/:sessionId',
    element: <SessionWorkspacePage />,
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
      <RoutePlaceholder
        title="Models & Inference Providers"
        milestone="Milestone 5"
        description="Configure Ollama endpoints, Groq API keys, OpenAI-compatible servers, and calibrate model parameters."
      />
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
      <RoutePlaceholder
        title="Identities & Auth Vault"
        milestone="Milestone 5"
        description="Manage cookie sessions, token vault credentials, and launch embedded handover browsers."
      />
    ),
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
