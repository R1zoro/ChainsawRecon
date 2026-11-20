import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { WorkbenchPage } from '../features/workbench/WorkbenchPage';
import { OastWorkspace } from '../features/workbench/components/OastWorkspace';
import { 
  resetMockData, 
  setMockServiceMode, 
  setMockOastStatus, 
  setMockOastTokens, 
  setMockOastEvents,
  fetchFindings
} from '../api/mockService';

function renderOastWorkspace(projectId = 'prj_demo') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <OastWorkspace projectId={projectId} />
    </QueryClientProvider>
  );
}

function renderWorkbenchOast(projectId = 'prj_demo') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${projectId}/oast`]}>
        <Routes>
          <Route path="/projects/:projectId/oast" element={<WorkbenchPage />} />
          <Route path="/projects/:projectId/workbench" element={<WorkbenchPage />} />
          <Route path="/workbench" element={<WorkbenchPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OAST / Callbacks Tab Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
    vi.clearAllMocks();
  });

  it('navigates to OAST tab and displays listening URL, DNS port/domain, and event count in Workbench', async () => {
    renderWorkbenchOast('prj_demo');

    await waitFor(() => {
      expect(screen.getByTestId('oast-workspace')).toBeInTheDocument();
      expect(screen.getByText(/Out-of-Band \(OAST\) Callbacks/i)).toBeInTheDocument();
    });

    // Check OAST tab button in header is marked active
    const oastTabBtn = screen.getByRole('button', { name: /OAST \/ Callbacks/i });
    expect(oastTabBtn).toBeInTheDocument();

    // Verify listening status badge and DNS domain/port
    await waitFor(() => {
      expect(screen.getByText(/Listening:/i)).toBeInTheDocument();
      expect(screen.getAllByText(/45678/i).length).toBeGreaterThan(0);
      expect(screen.getByTestId('oast-dns-status')).toBeInTheDocument();
      expect(screen.getByText(/DNS: oast\.local:53535/i)).toBeInTheDocument();
    });
  });

  it('handles start and stop server lifecycle with DNS fields', async () => {
    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Stop Server/i })).toBeInTheDocument();
    });

    // Stop server
    fireEvent.click(screen.getByRole('button', { name: /Stop Server/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Server/i })).toBeInTheDocument();
      expect(screen.getByText(/Server Stopped/i)).toBeInTheDocument();
    });

    // Start server again
    fireEvent.click(screen.getByRole('button', { name: /Start Server/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Stop Server/i })).toBeInTheDocument();
      expect(screen.getByText(/Listening:/i)).toBeInTheDocument();
      expect(screen.getByText(/DNS: oast\.local:53535/i)).toBeInTheDocument();
    });
  });

  it('creates a new token with note, displays dnsName, and allows copying both HTTP URL and DNS name', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    renderOastWorkspace('prj_demo');

    // Wait until server is running, New Token button is enabled, and tokens loaded
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /New Token/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
      expect(screen.getAllByText('oast_9f83a21b44c01d9e22fa.oast.local').length).toBeGreaterThan(0);
    });

    // Copy DNS name
    const copyDnsButtons = screen.getAllByRole('button', { name: /Copy DNS/i });
    expect(copyDnsButtons.length).toBeGreaterThan(0);
    fireEvent.click(copyDnsButtons[0]);
    expect(writeTextMock).toHaveBeenCalledWith('oast_9f83a21b44c01d9e22fa.oast.local');

    // Click New Token
    fireEvent.click(screen.getByRole('button', { name: /New Token/i }));

    // Form appears
    await waitFor(() => {
      expect(screen.getByLabelText(/Payload Note \/ Hypothesis Context/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/Payload Note \/ Hypothesis Context/i);
    fireEvent.change(input, { target: { value: 'Blind SSRF in Webhook Integration' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));

    await waitFor(() => {
      expect(screen.getByText('Blind SSRF in Webhook Integration')).toBeInTheDocument();
    });

    // Primary HTTP URL copy
    const copyHttpButtons = screen.getAllByRole('button', { name: /^Copy$/i });
    expect(copyHttpButtons.length).toBeGreaterThan(0);
    fireEvent.click(copyHttpButtons[0]);
    expect(writeTextMock).toHaveBeenCalled();
  });

  it('renders token hit count badge', async () => {
    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByText(/2 hits/i)).toBeInTheDocument();
      expect(screen.getByText(/0 hits/i)).toBeInTheDocument();
    });
  });

  it('renders received event stream and redacts sensitive headers upon expand for HTTP requests', async () => {
    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByText('/t/oast_9f83a21b44c01d9e22fa')).toBeInTheDocument();
      expect(screen.getByText('10.0.4.12:54322')).toBeInTheDocument();
    });

    // Expand the event
    const eventCard = screen.getByTestId('oast-event-1');
    fireEvent.click(eventCard.querySelector('div')!);

    await waitFor(() => {
      expect(screen.getByText(/HTTP Request Headers \(Redacted\)/i)).toBeInTheDocument();
      // Sensitive headers should be redacted
      const redactedElements = screen.getAllByText('«redacted»');
      expect(redactedElements.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText(/authorization:/i)).toBeInTheDocument();
      expect(screen.getByText(/cookie:/i)).toBeInTheDocument();
    });
  });

  it('renders DNS callback events with method DNS and displays A-record query details upon expand', async () => {
    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByTestId('oast-event-3')).toBeInTheDocument();
      expect(screen.getAllByText('oast_9f83a21b44c01d9e22fa.oast.local').length).toBeGreaterThan(0);
    });

    // Verify method badge in event 3
    const dnsEventCard = screen.getByTestId('oast-event-3');
    expect(dnsEventCard.textContent).toContain('DNS');

    // Expand the DNS event
    fireEvent.click(dnsEventCard.querySelector('div')!);

    await waitFor(() => {
      expect(screen.getByText(/DNS Query Details \(Raw A-Record\)/i)).toBeInTheDocument();
      expect(screen.getByText(/A \(Type 1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/A-record-only raw DNS query, no recursion \/ DNSSEC/i)).toBeInTheDocument();
    });
  });

  it('filters events by token and preserves DNS events matching token', async () => {
    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByTestId('token-card-oast_9f83a21b44c01d9e22fa')).toBeInTheDocument();
    });

    // Click on token to filter
    fireEvent.click(screen.getByTestId('token-card-oast_9f83a21b44c01d9e22fa'));

    await waitFor(() => {
      expect(screen.getByText(/Filtering by token:/i)).toBeInTheDocument();
      // DNS event for this token should be visible
      expect(screen.getByTestId('oast-event-3')).toBeInTheDocument();
      expect(screen.getAllByText('oast_9f83a21b44c01d9e22fa.oast.local').length).toBeGreaterThan(0);
    });

    // Clear filter
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Filtering by token:/i)).not.toBeInTheDocument();
    });
  });

  it('renders stopped empty state when server is stopped with no tokens', async () => {
    setMockOastStatus('prj_empty', { running: false, tokenCount: 0, eventCount: 0 });
    setMockOastTokens('prj_empty', []);
    setMockOastEvents('prj_empty', []);

    renderOastWorkspace('prj_empty');

    await waitFor(() => {
      expect(screen.getByTestId('oast-stopped-state')).toBeInTheDocument();
    });
  });

  it('renders no-tokens and no-callbacks empty states when server is running with no data', async () => {
    setMockOastStatus('prj_empty2', { running: true, tokenCount: 0, eventCount: 0, url: 'http://127.0.0.1:45678', dnsPort: 53535, dnsDomain: 'oast.local' });
    setMockOastTokens('prj_empty2', []);
    setMockOastEvents('prj_empty2', []);

    renderOastWorkspace('prj_empty2');

    await waitFor(() => {
      expect(screen.getByTestId('oast-no-tokens-state')).toBeInTheDocument();
      expect(screen.getByTestId('oast-no-callbacks-state')).toBeInTheDocument();
    });
  });

  it('displays required security warnings including A-record-only raw DNS, no recursion/DNSSEC, and primary HTTP', async () => {
    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByText(/OAST Security Boundaries & Caveats/i)).toBeInTheDocument();
      expect(screen.getByText(/Primary HTTP:/i)).toBeInTheDocument();
      expect(screen.getByText(/DNS support:/i)).toBeInTheDocument();
      expect(screen.getByText(/A-record-only raw DNS queries \(no recursion \/ DNSSEC\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Defaults to/i)).toBeInTheDocument();
      expect(screen.getByText(/not automatically validated findings/i)).toBeInTheDocument();
      expect(screen.getByText('oast_9f83a21b44c01d9e22fa')).toBeInTheDocument();
    });
  });

  it('boundary guarantee: receiving callbacks does not automatically create findings', async () => {
    // Check initial findings
    const initialFindings = await fetchFindings();
    const initialFindingCount = initialFindings.total;

    renderOastWorkspace('prj_demo');

    await waitFor(() => {
      expect(screen.getByText(/Received Callbacks/i)).toBeInTheDocument();
      expect(screen.getByText('oast_9f83a21b44c01d9e22fa')).toBeInTheDocument();
      expect(screen.getByText('/t/oast_9f83a21b44c01d9e22fa')).toBeInTheDocument();
    });

    // Ensure findings collection did not mutate
    const postFindings = await fetchFindings();
    expect(postFindings.total).toBe(initialFindingCount);
  });
});
