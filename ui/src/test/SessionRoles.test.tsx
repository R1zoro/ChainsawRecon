import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionRunPanel } from '../features/sessions/components/SessionRunPanel';
import { SessionWorkspacePage } from '../features/sessions/SessionWorkspacePage';
import { resetMockData, setMockServiceMode } from '../api/mockService';
import * as client from '../api/client';

const renderSessionRunPanel = (props: {
  sessionId?: string;
  sessionProvider?: string;
  sessionModel?: string;
  onRunComplete?: (res: unknown) => void;
  onClose?: () => void;
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
      <SessionRunPanel
        sessionId={props.sessionId || 'ses_demo_01'}
        sessionProvider={props.sessionProvider || 'prv_ollama'}
        sessionModel={props.sessionModel || 'qwen3:14b'}
        onRunComplete={props.onRunComplete}
        onClose={props.onClose}
      />
    </QueryClientProvider>
  );
};

const renderSessionWorkspace = (sessionId = 'ses_demo_01') => {
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
      <MemoryRouter initialEntries={[`/sessions/${sessionId}`]}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<SessionWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Session Run Role Matrix (UI_TASK_ROLES.md) Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders role matrix panel with all 5 standard roles defaulting to session provider/model', async () => {
    renderSessionRunPanel({
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
    });

    await waitFor(() => {
      expect(screen.getByTestId('session-run-panel')).toBeInTheDocument();
      expect(screen.getByText('Session Run Role Matrix')).toBeInTheDocument();
    });

    // Verify all 5 roles are present
    const roles = ['orchestrator', 'operator', 'recon', 'validator', 'reporter'];
    for (const role of roles) {
      expect(screen.getByTestId(`role-row-${role}`)).toBeInTheDocument();
      const provSelect = screen.getByLabelText(`${role} provider`) as HTMLSelectElement;
      expect(provSelect.value).toBe('prv_ollama');
    }
  });

  it('shows an amber warning when a role uses a Web UI provider', async () => {
    renderSessionRunPanel({
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
    });

    await waitFor(() => {
      expect(screen.getByLabelText('operator provider')).toBeInTheDocument();
    });

    // Initially no Web UI warning
    expect(screen.queryByText(/Web UI Provider Notice/i)).not.toBeInTheDocument();

    // Select ChatGPT Web for operator
    fireEvent.change(screen.getByLabelText('operator provider'), {
      target: { value: 'prv_chatgpt_web' },
    });

    // Warning banner should appear
    await waitFor(() => {
      expect(screen.getByText(/Web UI Provider Notice/i)).toBeInTheDocument();
      expect(screen.getByText(/Warning: Web UI provider will open a browser window and runs without native tool calls/i)).toBeInTheDocument();
    });
  });

  it('blocks unknown providers client-side and disables or blocks submission', async () => {
    // Mock localStorage with an unknown provider configuration
    localStorage.setItem('chainsaw_roles_ses_demo_01', JSON.stringify({
      orchestrator: { providerId: 'prv_non_existent', model: 'fake-model' },
      operator: { providerId: 'prv_ollama', model: 'qwen3:14b' },
      recon: { providerId: 'prv_ollama', model: 'qwen3:14b' },
      validator: { providerId: 'prv_ollama', model: 'qwen3:14b' },
      reporter: { providerId: 'prv_ollama', model: 'qwen3:14b' },
    }));

    renderSessionRunPanel({
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
    });

    await waitFor(() => {
      expect(screen.getByTestId('unknown-provider-error')).toBeInTheDocument();
      expect(screen.getByText(/Role 'Orchestrator' specifies unknown provider 'prv_non_existent'/i)).toBeInTheDocument();
    });

    // Run button must be disabled
    const runBtn = screen.getByRole('button', { name: /Start Session Run/i });
    expect(runBtn).toBeDisabled();
  });

  it('submits role matrix and sends ONLY non-default roles in POST /sessions/:id/run', async () => {
    const fetchJsonSpy = vi.spyOn(client, 'fetchJson');
    const onComplete = vi.fn();

    renderSessionRunPanel({
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
      onRunComplete: onComplete,
    });

    await waitFor(() => {
      expect(screen.getByLabelText('validator provider')).toBeInTheDocument();
    });

    // Change ONLY validator role to DeepSeek API
    fireEvent.change(screen.getByLabelText('validator provider'), {
      target: { value: 'prv_deepseek_api' },
    });

    // Submit the run
    const runBtn = screen.getByRole('button', { name: /Start Session Run/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });

    // Inspect the POST request payload sent
    const runCall = fetchJsonSpy.mock.calls.find(([path]) => path === '/sessions/ses_demo_01/run');
    expect(runCall).toBeDefined();

    const requestOptions = runCall?.[1];
    const parsedBody = JSON.parse(requestOptions?.body as string);

    // Default provider and model should be sent
    expect(parsedBody.providerId).toBe('prv_ollama');
    expect(parsedBody.model).toBe('qwen3:14b');

    // ONLY non-default role (validator) should be in roles; others omitted
    expect(parsedBody.roles).toBeDefined();
    expect(parsedBody.roles.validator).toEqual({
      providerId: 'prv_deepseek_api',
      model: 'deepseek-v4-flash',
    });
    expect(parsedBody.roles.orchestrator).toBeUndefined();
    expect(parsedBody.roles.operator).toBeUndefined();
    expect(parsedBody.roles.recon).toBeUndefined();
    expect(parsedBody.roles.reporter).toBeUndefined();
  });

  it('renders effective role -> model mapping from the response after execution', async () => {
    renderSessionRunPanel({
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Start Session Run/i })).toBeInTheDocument();
    });

    // Click run
    fireEvent.click(screen.getByRole('button', { name: /Start Session Run/i }));

    // Effective role mapping should render
    await waitFor(() => {
      expect(screen.getByTestId('effective-roles-mapping')).toBeInTheDocument();
      expect(screen.getByText('Effective Role Routing')).toBeInTheDocument();
    });

    const mappingSection = screen.getByTestId('effective-roles-mapping');
    expect(within(mappingSection).getByText(/orchestrator/i)).toBeInTheDocument();
    expect(within(mappingSection).getByText(/operator/i)).toBeInTheDocument();
    expect(within(mappingSection).getByText(/recon/i)).toBeInTheDocument();
    expect(within(mappingSection).getByText(/validator/i)).toBeInTheDocument();
    expect(within(mappingSection).getByText(/reporter/i)).toBeInTheDocument();
  });

  it('preserves role settings across component remounts in local storage per session', async () => {
    const { unmount } = renderSessionRunPanel({
      sessionId: 'ses_session_42',
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
    });

    await waitFor(() => {
      expect(screen.getByLabelText('recon provider')).toBeInTheDocument();
    });

    // Modify recon provider
    fireEvent.change(screen.getByLabelText('recon provider'), {
      target: { value: 'prv_deepseek_api' },
    });

    // Unmount and remount same session
    unmount();

    renderSessionRunPanel({
      sessionId: 'ses_session_42',
      sessionProvider: 'prv_ollama',
      sessionModel: 'qwen3:14b',
    });

    await waitFor(() => {
      const reconProv = screen.getByLabelText('recon provider') as HTMLSelectElement;
      expect(reconProv.value).toBe('prv_deepseek_api');
    });
  });

  it('opens Role Matrix modal from SessionWorkspacePage toolbar', async () => {
    renderSessionWorkspace('ses_demo_01');

    await waitFor(() => {
      expect(screen.getByTestId('open-run-config-btn')).toBeInTheDocument();
    });

    // Click Role Matrix button
    fireEvent.click(screen.getByTestId('open-run-config-btn'));

    // Modal opens
    await waitFor(() => {
      expect(screen.getByTestId('session-run-modal-backdrop')).toBeInTheDocument();
      expect(screen.getByText('Session Run Role Matrix')).toBeInTheDocument();
    });

    // Close button dismisses modal
    const closeBtn = screen.getByTitle('Close panel');
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('session-run-modal-backdrop')).not.toBeInTheDocument();
    });
  });
});
