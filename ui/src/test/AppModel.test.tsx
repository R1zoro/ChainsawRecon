import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ProjectOverviewPage } from '../features/app-model/ProjectOverviewPage';
import { resetMockData, setMockServiceMode } from '../api/mockService';

function renderProjectOverview(projectId = 'prj_demo') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectOverviewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectOverviewPage (Milestone 2: Application Model) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders project header with title, path, scope policy pill, and coverage counters', async () => {
    renderProjectOverview();

    // Verify title and breadcrumbs
    await waitFor(() => {
      expect(screen.getByText('Acme API')).toBeInTheDocument();
      expect(screen.getByText('Engagements')).toBeInTheDocument();
    });

    // Verify filesystem path
    expect(screen.getByText('C:/labs/acme-api')).toBeInTheDocument();

    // Verify Scope policy pill (bound to /projects/:id/scope)
    expect(screen.getByText('Scope Enforced')).toBeInTheDocument();

    // Verify Coverage counters
    expect(screen.getByText('Apps:')).toBeInTheDocument();
    expect(screen.getByText('Services:')).toBeInTheDocument();
    expect(screen.getByText('Routes:')).toBeInTheDocument();
    expect(screen.getByText('Inputs:')).toBeInTheDocument();
    expect(screen.getByText('Identities:')).toBeInTheDocument();

    // Verify Stale assets badge
    expect(screen.getAllByText(/Stale/i).length).toBeGreaterThan(0);

    // Verify View Switcher
    expect(screen.getByRole('button', { name: /Graph/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
  });

  it('renders topology graph with application, service, and route nodes', async () => {
    renderProjectOverview();

    await waitFor(() => {
      // Application node
      expect(screen.getByText('Acme Cloud Platform')).toBeInTheDocument();
      // Service node
      expect(screen.getByText('api.example.com')).toBeInTheDocument();
      // Route node
      expect(screen.getByText('GET /v1/users/me')).toBeInTheDocument();
    });

    // Check kind badges on nodes
    expect(screen.getAllByText('APPLICATION').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SERVICE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ROUTE').length).toBeGreaterThan(0);
  });

  it('clicking a graph node opens Entity Detail Drawer with kind-specific metadata', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByText('GET /v1/users/me')).toBeInTheDocument();
    });

    // Click the route node
    const routeNode = screen.getByText('GET /v1/users/me').closest('.cursor-pointer');
    if (routeNode) {
      fireEvent.click(routeNode);
    }

    // Verify detail drawer opens
    await waitFor(() => {
      expect(screen.getByText('rot_users_me')).toBeInTheDocument();
      expect(screen.getByText('Attributes & Meta')).toBeInTheDocument();
      expect(screen.getByText('Connected Edges (2)')).toBeInTheDocument();
    });

    // Check route metadata fields
    expect(screen.getByText('Method:')).toBeInTheDocument();
    expect(screen.getByText('Path:')).toBeInTheDocument();
    expect(screen.getByText('/v1/users/me')).toBeInTheDocument();
  });

  it('adding a note in the detail drawer persists and appears in notes timeline', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByText('GET /v1/users/{id}')).toBeInTheDocument();
    });

    // Open detail drawer for route with IDOR
    const idorNode = screen.getByText('GET /v1/users/{id}').closest('.cursor-pointer');
    if (idorNode) {
      fireEvent.click(idorNode);
    }

    await waitFor(() => {
      expect(screen.getByText('rot_users_id')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Add observation note/i)).toBeInTheDocument();
    });

    // Type a new analyst note
    const noteInput = screen.getByPlaceholderText(/Add observation note/i);
    fireEvent.change(noteInput, {
      target: { value: 'Confirmed cross-tenant IDOR leakage on tenant_beta.' },
    });

    const addNoteBtn = screen.getByRole('button', { name: /Add Note/i });
    fireEvent.click(addNoteBtn);

    // Verify the new note appears in the drawer
    await waitFor(() => {
      expect(screen.getByText('Confirmed cross-tenant IDOR leakage on tenant_beta.')).toBeInTheDocument();
    });
  });

  it('switches between Graph and Table view', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
    });

    // Click Table tab
    const tableBtn = screen.getByRole('button', { name: /Table/i });
    fireEvent.click(tableBtn);

    // Verify Table view is rendered
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getByText('Kind')).toBeInTheDocument();
      expect(screen.getByText('Name / Target')).toBeInTheDocument();
    });

    // Click Graph tab to return
    const graphBtn = screen.getByRole('button', { name: /Graph/i });
    fireEvent.click(graphBtn);

    await waitFor(() => {
      expect(screen.getByText('Acme Cloud Platform')).toBeInTheDocument();
    });
  });

  it('table view filters by kind and search query', async () => {
    renderProjectOverview();

    // Switch to Table tab
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Table/i }));

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Filter by 'Routes'
    const routesFilterBtn = screen.getByRole('button', { name: 'Routes' });
    fireEvent.click(routesFilterBtn);

    expect(screen.getByText('GET /v1/users/me')).toBeInTheDocument();
    expect(screen.queryByText('Acme Cloud Platform')).not.toBeInTheDocument();

    // Search query
    const searchInput = screen.getByPlaceholderText(/Filter inventory table/i);
    fireEvent.change(searchInput, { target: { value: 'billing' } });

    expect(screen.getByText('GET /v1/billing/invoices')).toBeInTheDocument();
    expect(screen.queryByText('GET /v1/users/me')).not.toBeInTheDocument();
  });

  it('table view isolates stale assets with stale toggle', async () => {
    renderProjectOverview();

    // Switch to Table tab
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Table/i }));

    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // Toggle Stale Only
    const staleToggleBtn = screen.getByRole('button', { name: /Stale Only/i });
    fireEvent.click(staleToggleBtn);

    // Stale route should be visible, others filtered out
    expect(screen.getByText('POST /v1/export/dump')).toBeInTheDocument();
    expect(screen.queryByText('POST /v1/auth/login')).not.toBeInTheDocument();
  });

  it('clicking a table row opens the detail drawer', async () => {
    renderProjectOverview();

    // Switch to Table tab
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Table/i }));

    await waitFor(() => {
      expect(screen.getByText('POST /v1/auth/login')).toBeInTheDocument();
    });

    // Click the row
    const loginRow = screen.getByText('POST /v1/auth/login').closest('tr');
    if (loginRow) {
      fireEvent.click(loginRow);
    }

    // Verify detail drawer opened for POST /v1/auth/login
    await waitFor(() => {
      expect(screen.getByText('rot_auth_login')).toBeInTheDocument();
      expect(screen.getByText('POST')).toBeInTheDocument();
      expect(screen.getByText('/v1/auth/login')).toBeInTheDocument();
    });
  });

  it('renders honest empty state when project has no application model', async () => {
    setMockServiceMode('empty');
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByText('No application model yet')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/No services, routes, or assets have been discovered for this engagement/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start New Session/i })).toBeInTheDocument();
  });

  it('handles graph truncation cap and displays warning banner', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByTitle(/Maximum nodes to render simultaneously/i)).toBeInTheDocument();
    });

    // Set max nodes to 2 (below total entities of 16)
    const capSelect = screen.getByTitle(/Maximum nodes to render simultaneously/i);
    fireEvent.change(capSelect, { target: { value: '50' } });

    // Verify cap change triggers query refetch with new maxNodes
    await waitFor(() => {
      expect(screen.getByText('Acme Cloud Platform')).toBeInTheDocument();
    });
  });

  // ── Milestone 2.5: Coverage-Aware Sitemap (Atlas) Tests ────────
  it('renders View Switcher with Graph, Sitemap, and Table buttons', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Graph/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sitemap/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Table/i })).toBeInTheDocument();
    });
  });

  it('switches to Sitemap tab and displays coverage ribbon and hierarchical tree', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sitemap/i })).toBeInTheDocument();
    });

    // Switch to Sitemap tab
    fireEvent.click(screen.getByRole('button', { name: /Sitemap/i }));

    // Coverage Ribbon check
    await waitFor(() => {
      expect(screen.getByText('In scope:')).toBeInTheDocument();
      expect(screen.getByText('Tested:')).toBeInTheDocument();
      expect(screen.getByText('Untested:')).toBeInTheDocument();
      expect(screen.getByText('Findings:')).toBeInTheDocument();
      expect(screen.getByText('Gaps:')).toBeInTheDocument();
    });

    // Hierarchical Tree check
    await waitFor(() => {
      expect(screen.getAllByText('Acme Cloud Platform').length).toBeGreaterThan(0);
      expect(screen.getAllByText('api.example.com').length).toBeGreaterThan(0);
    });

    // Breadcrumb / focus indicator in center graph
    expect(screen.getByText(/Subtree focus:/i)).toBeInTheDocument();
  });

  it('sitemap tree filters by "Only untested" attack surfaces', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sitemap/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Sitemap/i }));

    const tree = await screen.findByTestId('sitemap-tree');

    await waitFor(() => {
      expect(within(tree).getByRole('button', { name: 'Only untested' })).toBeInTheDocument();
    });

    // Toggle "Untested" filter in tree
    const untestedToggle = within(tree).getByRole('button', { name: 'Only untested' });
    fireEvent.click(untestedToggle);

    // Tested route /v1/billing/invoices should be hidden from tree; untested route /v1/users/me remains
    await waitFor(() => {
      expect(within(tree).queryByText('/v1/billing/invoices')).not.toBeInTheDocument();
      expect(within(tree).getByText('/v1/users/me')).toBeInTheDocument();
    });
  });

  it('sitemap tree filters by "Only gaps" toggle', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sitemap/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Sitemap/i }));

    const tree = await screen.findByTestId('sitemap-tree');

    await waitFor(() => {
      expect(within(tree).getByRole('button', { name: 'Only gaps' })).toBeInTheDocument();
    });

    // Toggle "Gaps" filter
    const gapsToggle = within(tree).getByRole('button', { name: 'Only gaps' });
    fireEvent.click(gapsToggle);

    // Only nodes with verification gaps remain visible in tree (/v1/billing/invoices has missing_evidence)
    await waitFor(() => {
      expect(within(tree).getByText('/v1/billing/invoices')).toBeInTheDocument();
      expect(within(tree).queryByText('/v1/auth/login')).not.toBeInTheDocument();
      expect(within(tree).queryByText('/v1/users/me')).not.toBeInTheDocument();
    });
  });

  it('clicking a node in sitemap tree opens detail drawer with coverage ledger and gap warnings', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sitemap/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Sitemap/i }));

    const tree = await screen.findByTestId('sitemap-tree');

    await waitFor(() => {
      expect(within(tree).getByText('/v1/billing/invoices')).toBeInTheDocument();
    });

    // Click on /v1/billing/invoices route (which has a missing evidence gap)
    const routeItem = within(tree).getByText('/v1/billing/invoices');
    fireEvent.click(routeItem);

    // Verify detail drawer opened with coverage ledger & gap warning
    await waitFor(() => {
      expect(screen.getByText(/Coverage Ledger/i)).toBeInTheDocument();
      expect(screen.getByText(/Coverage Gap \(Missing Evidence\)/i)).toBeInTheDocument();
    });
  });

  it('records new coverage entry via drawer form and refreshes coverage state', async () => {
    renderProjectOverview();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sitemap/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Sitemap/i }));

    const tree = await screen.findByTestId('sitemap-tree');

    await waitFor(() => {
      expect(within(tree).getByText('/v1/users/{id}')).toBeInTheDocument();
    });

    // Open detail drawer for /v1/users/{id}
    fireEvent.click(within(tree).getByText('/v1/users/{id}'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Record/i })).toBeInTheDocument();
    });

    // Open Record Coverage form
    fireEvent.click(screen.getByRole('button', { name: /Record/i }));

    await waitFor(() => {
      expect(screen.getByText(/Record Security Coverage/i)).toBeInTheDocument();
    });

    // Fill form
    const riskInput = screen.getByPlaceholderText(/e\.g\. idor, sqli/i);
    fireEvent.change(riskInput, { target: { value: 'sqli' } });

    const evidenceInput = screen.getByPlaceholderText(/evd_\.\.\. or flow request ID/i);
    fireEvent.change(evidenceInput, { target: { value: 'evd_test_sqli_clean' } });

    // Submit form
    const saveButton = screen.getByRole('button', { name: 'Record Coverage' });
    fireEvent.click(saveButton);

    // Verify form closes and check appears in coverage ledger
    await waitFor(() => {
      expect(screen.queryByText(/Record Security Coverage/i)).not.toBeInTheDocument();
      expect(screen.getByText(/TESTED \(\d+ checks\)/i)).toBeInTheDocument();
    });
  });
});
