import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolRunTab } from '../features/sessions/components/ToolRunTab';
import { resetMockData, setMockServiceMode, setMockAuthProfiles, setMockSandboxStatus } from '../api/mockService';

const renderToolRun = (props: {
  sessionId?: string;
  projectId?: string;
  defaultProviderId?: string;
  defaultModel?: string;
  onToolRunComplete?: () => void;
} = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/sessions/ses_active_01']}>
        <Routes>
          <Route
            path="/sessions/:sessionId"
            element={
              <ToolRunTab
                sessionId={props.sessionId || 'ses_active_01'}
                projectId={props.projectId || 'prj_demo'}
                defaultProviderId={props.defaultProviderId}
                defaultModel={props.defaultModel}
                onToolRunComplete={props.onToolRunComplete}
              />
            }
          />
          <Route path="/projects/:projectId/findings" element={<div>Findings Target Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('ToolRunTab (Milestone 5: Phase B Tool Agent Run) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders prompt composer, controls (provider, model, max steps, noise profile), and empty state', async () => {
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByText('Autonomous Security Tool Agent')).toBeInTheDocument();
      expect(screen.getByLabelText(/Task Prompt/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Provider/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Model/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Max Steps/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Noise Profile/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Run Agent/i })).toBeInTheDocument();
      expect(screen.getByTestId('tool-run-empty-state')).toBeInTheDocument();
      expect(screen.getByText(/Agent uses captured traffic and scoped tools only/i)).toBeInTheDocument();
    });
  });

  it('disables auth profile selector with "No active auth profile" when none are active', async () => {
    // Override profiles so none are active
    setMockAuthProfiles([
      {
        id: 'auth_inactive_01',
        label: 'Inactive Admin',
        identity: 'admin',
        role: 'admin',
        tenant: 'default',
        kind: 'credentials',
        adapter: 'http_form',
        persistence: 'session_only',
        targetPatterns: [],
        loginUrl: '',
        verifyUrl: '',
        verifyIndicator: '',
        session: {
          profileId: 'auth_inactive_01',
          projectId: 'prj_demo',
          status: 'none',
          hasCookies: false,
          hasStorageState: false,
        },
      },
    ]);

    renderToolRun();

    await waitFor(() => {
      const authSelect = screen.getByLabelText(/Target Auth Profile/i) as HTMLSelectElement;
      expect(authSelect.disabled).toBe(true);
      expect(screen.getByText('No active auth profile')).toBeInTheDocument();
      expect(screen.getByText('No active auth session found')).toBeInTheDocument();
    });
  });

  it('enables auth selector and populates active profiles when available', async () => {
    renderToolRun();

    await waitFor(() => {
      const authSelect = screen.getByLabelText(/Target Auth Profile/i) as HTMLSelectElement;
      expect(authSelect.disabled).toBe(false);
      expect(screen.getByText(/Primary Admin Account/i)).toBeInTheDocument();
    });
  });

  it('submits tool-run request and renders final answer and tool-call timeline with redacted arguments', async () => {
    const onComplete = vi.fn();
    renderToolRun({ onToolRunComplete: onComplete });

    await waitFor(() => {
      expect(screen.getByLabelText(/Task Prompt/i)).toBeInTheDocument();
    });

    const promptInput = screen.getByLabelText(/Task Prompt/i);
    fireEvent.change(promptInput, {
      target: { value: 'Investigate invoice endpoint for IDOR vulnerability' },
    });

    const submitBtn = screen.getByRole('button', { name: /Run Agent/i });
    fireEvent.click(submitBtn);

    // Results should render
    await waitFor(() => {
      expect(screen.getByTestId('tool-run-result')).toBeInTheDocument();
      expect(screen.getByText('Agent Final Answer')).toBeInTheDocument();
      expect(screen.getByText(/Completed task for prompt:/i)).toBeInTheDocument();
      expect(screen.getByText('Status: completed')).toBeInTheDocument();
      expect(screen.getByText('Steps: 3')).toBeInTheDocument();
    });

    // Check tool timeline items
    expect(screen.getByTestId('tool-call-0')).toBeInTheDocument();
    expect(within(screen.getByTestId('tool-call-0')).getByText('workbench.search')).toBeInTheDocument();
    expect(within(screen.getByTestId('tool-call-1')).getByText('http.replay')).toBeInTheDocument();
    expect(within(screen.getByTestId('tool-call-2')).getByText('evidence.record')).toBeInTheDocument();

    // Verify onComplete callback called
    expect(onComplete).toHaveBeenCalled();
  });

  it('expands tool call to view redacted arguments and result details', async () => {
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByLabelText(/Task Prompt/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Task Prompt/i), {
      target: { value: 'Inspect headers and replay requests' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Agent/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tool-call-1')).toBeInTheDocument();
    });

    // Click http.replay call in tool-call-1 to expand
    fireEvent.click(within(screen.getByTestId('tool-call-1')).getByText('http.replay'));

    await waitFor(() => {
      expect(screen.getByText('Arguments (Redacted)')).toBeInTheDocument();
      expect(screen.getByText(/Test cross-tenant invoice boundary/i)).toBeInTheDocument();
    });
  });

  it('renders clickable evidence link on tool calls that record evidence', async () => {
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByLabelText(/Task Prompt/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Task Prompt/i), {
      target: { value: 'Record evidence of boundary check' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Agent/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Evidence: evd_invoice_boundary_403/i).length).toBeGreaterThan(0);
    });

    // Click the evidence link
    const evBtn = screen.getAllByText(/Evidence: evd_invoice_boundary_403/i)[0];
    fireEvent.click(evBtn);

    // Navigates to findings page
    await waitFor(() => {
      expect(screen.getByText('Findings Target Page')).toBeInTheDocument();
    });
  });

  it('renders error banner when provider is not configured or execution fails', async () => {
    setMockServiceMode('error');
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByLabelText(/Task Prompt/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Task Prompt/i), {
      target: { value: 'Run test that fails due to error mode' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Agent/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tool-run-error')).toBeInTheDocument();
      expect(screen.getByText(/no provider configured; add one before running a tool session/i)).toBeInTheDocument();
    });
  });

  it('fetches and displays sandbox status and shows partial warning on partial backend', async () => {
    setMockSandboxStatus({
      name: 'windows-job',
      strength: 'partial',
      available: true,
    });
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByText(/windows-job \(partial\)/i)).toBeInTheDocument();
      expect(screen.getByText('This platform currently provides process limits, not full filesystem isolation.')).toBeInTheDocument();
    });
  });

  it('does not show partial warning when sandbox strength is native', async () => {
    setMockSandboxStatus({
      name: 'bwrap',
      strength: 'native',
      available: true,
    });
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByText(/bwrap \(native\)/i)).toBeInTheDocument();
      expect(screen.queryByText('This platform currently provides process limits, not full filesystem isolation.')).not.toBeInTheDocument();
    });
  });

  it('disables shell toggle and displays (Unavailable) when sandbox is not available', async () => {
    setMockSandboxStatus({
      name: 'unavailable',
      strength: 'none',
      available: false,
    });
    renderToolRun();

    await waitFor(() => {
      const toggle = screen.getByLabelText(/Allow shell execution/i) as HTMLInputElement;
      expect(toggle.disabled).toBe(true);
      expect(screen.getByText('(Unavailable)')).toBeInTheDocument();
    });
  });

  it('sends allowShell in request body when enabled and renders shell.exec result with stdout/stderr/evidence', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    setMockSandboxStatus({
      name: 'windows-job',
      strength: 'partial',
      available: true,
    });
    renderToolRun();

    await waitFor(() => {
      expect(screen.getByLabelText(/Task Prompt/i)).toBeInTheDocument();
      expect(screen.getByText(/windows-job \(partial\)/i)).toBeInTheDocument();
    });

    // Check allowShell toggle
    const toggle = screen.getByLabelText(/Allow shell execution/i) as HTMLInputElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    fireEvent.change(screen.getByLabelText(/Task Prompt/i), {
      target: { value: 'Run curl test to inspect response code' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Agent/i }));

    // Wait for result
    await waitFor(() => {
      expect(screen.getByTestId('tool-run-result')).toBeInTheDocument();
      expect(screen.getByText('shell.exec')).toBeInTheDocument();
    });

    // Verify shell.exec elements
    expect(screen.getByText('exit: 0')).toBeInTheDocument();
    expect(screen.getByText('Evidence: evd_shell_output_01')).toBeInTheDocument();

    // Verify command badge is visible
    expect(screen.getAllByText(/curl -s -i/i).length).toBeGreaterThan(0);

    // Expand shell.exec call details
    fireEvent.click(screen.getByText('shell.exec'));

    // Command in code block
    await waitFor(() => {
      expect(screen.getByText(/Command/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Stdout \(/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Stderr \(/i })).toBeInTheDocument();
    });

    // Stdout is collapsed by default: HTTP 403 text is not visible yet
    expect(screen.queryByText(/tenant_mismatch/i)).not.toBeInTheDocument();

    // Expand stdout
    fireEvent.click(screen.getByRole('button', { name: /Stdout \(/i }));
    await waitFor(() => {
      expect(screen.getByText(/tenant_mismatch/i)).toBeInTheDocument();
    });

    // Click copy stdout button
    const copyBtn = screen.getByRole('button', { name: /Copy stdout/i });
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('tenant_mismatch'));
  });

  it('provides no shell capability or tool execution when sandbox is unavailable', async () => {
    setMockSandboxStatus({
      name: 'unavailable',
      strength: 'none',
      available: false,
    });
    renderToolRun();

    await waitFor(() => {
      const toggle = screen.getByLabelText(/Allow shell execution/i) as HTMLInputElement;
      expect(toggle.disabled).toBe(true);
    });

    // Try to click the disabled toggle
    const toggle = screen.getByLabelText(/Allow shell execution/i) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);

    fireEvent.change(screen.getByLabelText(/Task Prompt/i), {
      target: { value: 'Attempt to execute shell commands when unavailable' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Run Agent/i }));

    await waitFor(() => {
      expect(screen.getByTestId('tool-run-result')).toBeInTheDocument();
    });

    // Result should NOT contain shell.exec
    expect(screen.queryByText('shell.exec')).not.toBeInTheDocument();
  });
});
