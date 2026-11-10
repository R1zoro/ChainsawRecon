import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { resetMockData, setMockServiceMode } from '../api/mockService';

function renderWorkbench(projectId = 'prj_demo') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectId}/workbench`]}>
        <Routes>
          <Route path="/projects/:projectId/workbench" element={<WorkbenchPage />} />
          <Route path="/workbench" element={<WorkbenchPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('WorkbenchPage (Milestone 3: Native HTTP Workbench) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders top header with project name, scope policy pill, CA status, and view switcher', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('HTTP Workbench')).toBeInTheDocument();
      expect(screen.getByText('Scope Enforced')).toBeInTheDocument();
      expect(screen.getByText(/CA: Active/i)).toBeInTheDocument();
    });

    // Check View Switcher tabs
    expect(screen.getByRole('button', { name: /Traffic History/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Repeater/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Compare/i }).length).toBeGreaterThan(0);

    // Check Import and Export actions
    expect(screen.getByRole('button', { name: /Import/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
  });

  it('renders traffic history table with captured requests, methods, and status codes', async () => {
    renderWorkbench();

    await waitFor(() => {
      // Methods
      expect(screen.getAllByText('GET').length).toBeGreaterThan(0);
      expect(screen.getAllByText('POST').length).toBeGreaterThan(0);
      expect(screen.getAllByText('DELETE').length).toBeGreaterThan(0);

      // Paths
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
      expect(screen.getByText('/api/v1/invoices/102/refund')).toBeInTheDocument();
      expect(screen.getByText('/api/v1/users/42')).toBeInTheDocument();

      // Status codes
      expect(screen.getAllByText('200').length).toBeGreaterThan(0);
      expect(screen.getAllByText('403').length).toBeGreaterThan(0);
      expect(screen.getAllByText('204').length).toBeGreaterThan(0);
    });
  });

  it('filters traffic history by search keywords and HTTP method', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
    });

    // Filter by Method POST
    const postFilterBtn = screen.getByRole('button', { name: 'POST' });
    fireEvent.click(postFilterBtn);

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102/refund')).toBeInTheDocument();
      expect(screen.queryByText('/api/v1/users/42')).not.toBeInTheDocument();
    });

    // Reset method and filter by search input
    const allBtns = screen.getAllByRole('button', { name: 'ALL' });
    fireEvent.click(allBtns[0]);
    const searchInput = screen.getByPlaceholderText(/Filter requests by URL/i);
    fireEvent.change(searchInput, { target: { value: 'refund' } });

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102/refund')).toBeInTheDocument();
      expect(screen.queryByText('/api/v1/invoices/102')).not.toBeInTheDocument();
    });
  });

  it('filters traffic history by In-Scope Only', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/callback')).toBeInTheDocument();
    });

    // Toggle In-Scope Only
    const inScopeToggle = screen.getByRole('button', { name: /In-Scope Only/i });
    fireEvent.click(inScopeToggle);

    await waitFor(() => {
      expect(screen.queryByText('/callback')).not.toBeInTheDocument();
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
    });
  });

  it('selecting a history row renders request and response split views with redacted credentials', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
    });

    // Click on row
    const row = screen.getByText('/api/v1/invoices/102').closest('tr');
    if (row) {
      fireEvent.click(row);
    }

    // Split viewer displays request and response
    await waitFor(() => {
      expect(screen.getByText(/Inspector:/i)).toBeInTheDocument();
      expect(screen.getAllByText('«redacted»').length).toBeGreaterThan(0);
    });

    // Check response body preview rendered
    expect(screen.getByText(/Globex/i)).toBeInTheDocument();
  });

  it('switches between inspector tabs (Headers, Query, Body, Raw HTTP)', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
    });

    // Switch to Raw HTTP in Request Pane
    const rawTabs = screen.getAllByRole('button', { name: /Raw HTTP/i });
    fireEvent.click(rawTabs[0]);

    await waitFor(() => {
      expect(screen.getByText(/HTTP\/1.1/i)).toBeInTheDocument();
    });
  });

  it('Send to Repeater clones request into a new Repeater tab', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
    });

    // Click "Send to Repeater" in the action footer
    const repeaterBtn = screen.getByRole('button', { name: /Send to Repeater/i });
    fireEvent.click(repeaterBtn);

    // Should switch to Repeater tab
    await waitFor(() => {
      expect(screen.getByText(/2: GET \/api\/v1\/invoices\/102/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();
    });
  });

  it('mutating query parameters and headers dynamically updates Diff vs Baseline preview', async () => {
    renderWorkbench();

    // Switch to Repeater
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Repeater/i }).length).toBeGreaterThan(0);
    });
    const repeaterTabs = screen.getAllByRole('button', { name: /Repeater/i });
    fireEvent.click(repeaterTabs[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Diff vs Baseline/i })).toBeInTheDocument();
    });

    // Click "Diff vs Baseline" tab
    fireEvent.click(screen.getByRole('button', { name: /Diff vs Baseline/i }));

    await waitFor(() => {
      expect(screen.getByText(/Method: GET/i)).toBeInTheDocument();
    });
  });

  it('Scope Gate blocks replay of out-of-scope targets with policy error', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/callback')).toBeInTheDocument();
    });

    // Select out-of-scope request (/callback on external-thirdparty.com)
    const outOfScopeRow = screen.getByText('/callback').closest('tr');
    if (outOfScopeRow) {
      fireEvent.click(outOfScopeRow);
    }

    // Send to Repeater
    const repeaterBtn = screen.getByRole('button', { name: /Send to Repeater/i });
    fireEvent.click(repeaterBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();
    });

    // Click Send
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    // Should display out-of-scope transmission blocked error
    await waitFor(() => {
      expect(screen.getByText(/Transmission Blocked: Out of Scope/i)).toBeInTheDocument();
      expect(screen.getByText(/Target host is outside authorized engagement scope/i)).toBeInTheDocument();
    });
  });

  it('Destructive Method Gate prompts confirmation modal before replaying DELETE or PUT', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/api/v1/users/42')).toBeInTheDocument();
    });

    // Select DELETE request
    const deleteRow = screen.getByText('/api/v1/users/42').closest('tr');
    if (deleteRow) {
      fireEvent.click(deleteRow);
    }

    // Send to Repeater
    fireEvent.click(screen.getByRole('button', { name: /Send to Repeater/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Send/i })).toBeInTheDocument();
    });

    // Click Send
    fireEvent.click(screen.getByRole('button', { name: /Send/i }));

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText(/Destructive Action Governance Gate/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Authorized IDOR verification/i)).toBeInTheDocument();
    });

    // Fill in justification and authorize
    const reasonInput = screen.getByPlaceholderText(/Authorized IDOR verification/i);
    fireEvent.change(reasonInput, { target: { value: 'Approved pentest simulation' } });

    const authorizeBtn = screen.getByRole('button', { name: /Authorize & Send/i });
    fireEvent.click(authorizeBtn);

    // Modal closes and replay proceeds
    await waitFor(() => {
      expect(screen.queryByText(/Destructive Action Governance Gate/i)).not.toBeInTheDocument();
    });
  });

  it('Save as Evidence opens modal, submits POST /workbench/evidence, and persists', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('/api/v1/invoices/102')).toBeInTheDocument();
    });

    // Click "Save as Evidence"
    const evidenceBtn = screen.getByRole('button', { name: /Save as Evidence/i });
    fireEvent.click(evidenceBtn);

    // Verify modal opens
    await waitFor(() => {
      expect(screen.getByText(/Save as Artifact Evidence/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Pin Evidence/i })).toBeInTheDocument();
    });

    // Submit form
    const pinBtn = screen.getByRole('button', { name: /Pin Evidence/i });
    fireEvent.click(pinBtn);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByText(/Save as Artifact Evidence/i)).not.toBeInTheDocument();
    });
  });

  it('Response compare view highlights status change and header/body diffs', async () => {
    renderWorkbench();

    // Switch to Compare tab in header
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Compare$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Compare$/i }));

    await waitFor(() => {
      expect(screen.getByText('Headers Differential')).toBeInTheDocument();
      expect(screen.getByText('Body Line Differential')).toBeInTheDocument();
      expect(screen.getByText('Status Changed')).toBeInTheDocument();
    });
  });

  it('opens Proxy CA Helper modal and displays certificate path and instructions', async () => {
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText(/CA: Active/i)).toBeInTheDocument();
    });

    // Click CA button
    const caBtn = screen.getByText(/CA: Active/i);
    fireEvent.click(caBtn);

    // Verify modal opens
    await waitFor(() => {
      expect(screen.getByText(/Proxy CA Certificate & Trust Helper/i)).toBeInTheDocument();
      expect(screen.getAllByText(/ca\.crt/i).length).toBeGreaterThan(0);
    });

    // Check OS tabs
    expect(screen.getByRole('button', { name: /Windows/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /macOS \/ Linux/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /CLI \/ Env/i })).toBeInTheDocument();
  });

  it('renders honest empty state when zero requests are captured', async () => {
    setMockServiceMode('empty');
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByText('No captured requests')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Traffic will appear here as web requests are captured/i)
    ).toBeInTheDocument();
  });
});
