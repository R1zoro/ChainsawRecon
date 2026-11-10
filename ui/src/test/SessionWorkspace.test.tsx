import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SessionWorkspacePage } from '../features/sessions/SessionWorkspacePage';
import { resetMockData, setMockServiceMode } from '../api/mockService';
import { eventClient } from '../api/events';

function renderSessionWorkspace(sessionId = 'ses_demo_01') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
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
}

describe('SessionWorkspacePage (Milestone 1) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders top bar with title, status, project breadcrumb, scope pill, and approvals badge', async () => {
    renderSessionWorkspace();

    // Verify top bar details
    await waitFor(() => {
      expect(screen.getByText('Acme API authz sweep')).toBeInTheDocument();
      expect(screen.getByText('RUNNING')).toBeInTheDocument();
      expect(screen.getAllByText(/attack/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText('Scope Enforced').length).toBeGreaterThan(0);
      expect(screen.getByText(/1 Approval Pending/i)).toBeInTheDocument();
    });

    // Verify Left panel targets
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument();

    // Verify Task Board renders real task
    expect(screen.getAllByText('IDOR verification sweep').length).toBeGreaterThan(0);
    expect(screen.getAllByText('leased').length).toBeGreaterThan(0);

    // Verify Approvals Inbox renders real pending approval
    expect(screen.getAllByText('Run Active IDOR Payload Sweep').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0);

    // Verify Evidence quick list renders real evidence item from GET /sessions/{id}/evidence
    expect(screen.getAllByText(/GET \/v1\/users\/usr_100 returned 200 with tenant_beta data\./i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ART-001').length).toBeGreaterThan(0);
  });

  it('renders honest empty states when session has no tasks, approvals, or evidence', async () => {
    setMockServiceMode('empty');
    renderSessionWorkspace();

    await waitFor(() => {
      // Scope should be unknown when not confirmed
      expect(screen.getAllByText('Scope: Unknown').length).toBeGreaterThan(0);
    });

    // Honest empty states across panels
    expect(screen.getAllByText('No context assembled yet').length).toBeGreaterThan(0);
    expect(screen.getByText('Waiting for the controller to schedule work.')).toBeInTheDocument();
    expect(screen.getByText('No pending approvals.')).toBeInTheDocument();
    expect(screen.getByText('No evidence recorded yet.')).toBeInTheDocument();
  });

  it('renders live journal timeline with slash-qualified typed cards', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getByText('session/created')).toBeInTheDocument();
      expect(screen.getByText('decision')).toBeInTheDocument();
      expect(screen.getByText('action/result')).toBeInTheDocument();
      expect(screen.getByText('observation')).toBeInTheDocument();
      expect(screen.getByText('evidence/recorded')).toBeInTheDocument();
      expect(screen.getByText('finding/candidate')).toBeInTheDocument();
      expect(screen.getByText('approval/requested')).toBeInTheDocument();
    });

    // Check action content
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('/v1/users/me')).toBeInTheDocument();

    // Check finding content
    expect(screen.getByText(/Broken Object Level Authorization \(IDOR\) on \/v1\/users\/\{id\}/i)).toBeInTheDocument();
  });

  it('filters journal timeline by family tabs', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getByText('action/result')).toBeInTheDocument();
      expect(screen.getByText('evidence/recorded')).toBeInTheDocument();
    });

    // Click 'Actions' filter tab
    const actionsTab = screen.getByTestId('filter-action');
    fireEvent.click(actionsTab);

    // Only action events visible
    expect(screen.getByText('action/result')).toBeInTheDocument();
    expect(screen.queryByText('evidence/recorded')).not.toBeInTheDocument();
    expect(screen.queryByText('finding/candidate')).not.toBeInTheDocument();

    // Click 'Evidence' filter tab
    const evidenceTab = screen.getByTestId('filter-evidence');
    fireEvent.click(evidenceTab);

    expect(screen.queryByText('action/result')).not.toBeInTheDocument();
    expect(screen.getByText('evidence/recorded')).toBeInTheDocument();

    // Click 'All' to restore
    const allTab = screen.getByTestId('filter-all');
    fireEvent.click(allTab);

    expect(screen.getByText('action/result')).toBeInTheDocument();
    expect(screen.getByText('evidence/recorded')).toBeInTheDocument();
  });

  it('clicking a journal event opens it in the inspector', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getByText('decision')).toBeInTheDocument();
    });

    // Click the decision card
    const decisionCard = screen.getByText('decision').closest('.cursor-pointer');
    if (decisionCard) {
      fireEvent.click(decisionCard);
    }

    await waitFor(() => {
      expect(screen.getByText('Inspector')).toBeInTheDocument();
      expect(screen.getAllByText(/Initial surface mapping for https:\/\/api\.example\.com/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('operator composer sends a message to the journal', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Send guidance or directive to the orchestrator/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Send guidance or directive to the orchestrator/i);
    fireEvent.change(textarea, { target: { value: 'Inspect GraphQL schema on /graphql' } });

    const sendBtn = screen.getByRole('button', { name: /Send/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(screen.getByText('Inspect GraphQL schema on /graphql')).toBeInTheDocument();
    });
  });

  it('handles interactive approval Grant action with reason', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Run Active IDOR Payload Sweep').length).toBeGreaterThan(0);
      expect(screen.getByText('Review & Decide')).toBeInTheDocument();
    });

    // Open decision controls
    fireEvent.click(screen.getByText('Review & Decide'));

    // Input decision reason
    const reasonInput = screen.getByPlaceholderText(/Reason for decision/i);
    fireEvent.change(reasonInput, { target: { value: 'Authorized for stage 1 pentest' } });

    // Click Grant
    const grantBtn = screen.getByRole('button', { name: /Grant/i });
    fireEvent.click(grantBtn);

    // Verify approval status updates to granted and pending banner decrements
    await waitFor(() => {
      expect(screen.getByText('granted')).toBeInTheDocument();
      expect(screen.queryByText(/1 Approval Pending/i)).not.toBeInTheDocument();
    });
  });

  it('handles interactive approval Deny action with reason', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getAllByText('Run Active IDOR Payload Sweep').length).toBeGreaterThan(0);
      expect(screen.getByText('Review & Decide')).toBeInTheDocument();
    });

    // Open decision controls
    fireEvent.click(screen.getByText('Review & Decide'));

    // Input decision reason
    const reasonInput = screen.getByPlaceholderText(/Reason for decision/i);
    fireEvent.change(reasonInput, { target: { value: 'Out of scope endpoint' } });

    // Click Deny
    const denyBtn = screen.getByRole('button', { name: /Deny/i });
    fireEvent.click(denyBtn);

    // Verify approval status updates to denied
    await waitFor(() => {
      expect(screen.getByText('denied')).toBeInTheDocument();
    });
  });

  it('handles pause and resume run controls', async () => {
    renderSessionWorkspace();

    await waitFor(() => {
      expect(screen.getByText('RUNNING')).toBeInTheDocument();
    });

    // Pause session
    const pauseBtn = screen.getByRole('button', { name: /Pause/i });
    fireEvent.click(pauseBtn);

    await waitFor(() => {
      expect(screen.getByText('PAUSED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Resume/i })).toBeInTheDocument();
    });

    // Resume session
    const resumeBtn = screen.getByRole('button', { name: /Resume/i });
    fireEvent.click(resumeBtn);

    await waitFor(() => {
      expect(screen.getByText('RUNNING')).toBeInTheDocument();
    });
  });

  it('re-enables WebSocket reconnection when connect() is called after disconnect()', () => {
    eventClient.disconnect();
    expect(eventClient.getState()).toBe('disconnected');

    // Calling connect re-enables client
    eventClient.connect('ses_demo_01');
    expect(['connecting', 'reconnecting', 'connected']).toContain(eventClient.getState());

    // Clean up
    eventClient.disconnect();
  });
});
