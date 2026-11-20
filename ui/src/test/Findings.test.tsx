import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FindingsPage } from '../features/findings/FindingsPage';
import { resetMockData, setMockServiceMode } from '../api/mockService';

const renderFindings = (initialRoute = '/projects/prj_demo/findings') => {
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
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route path="/projects/:projectId/findings" element={<FindingsPage />} />
          <Route path="/projects/:projectId/findings/:findingId" element={<FindingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('FindingsPage (Milestone 4: Security Findings) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders header with project name, scope policy pill, stat counters, and findings list', async () => {
    renderFindings();

    // Verify header elements and findings in list once loaded
    await waitFor(() => {
      expect(screen.getByText('Security Findings')).toBeInTheDocument();
      expect(screen.getByText(/Scope: Enforced/i)).toBeInTheDocument();
      expect(screen.getAllByText('Cross-tenant invoice read').length).toBeGreaterThan(0);
      expect(screen.getByText('Reflected XSS in search endpoint')).toBeInTheDocument();
    });
  });

  it('filters findings by search keyword', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getAllByText('Cross-tenant invoice read').length).toBeGreaterThan(0);
    });

    // Search for "invoice"
    const searchInput = screen.getByPlaceholderText(/Search findings, VRT, asset/i);
    fireEvent.change(searchInput, { target: { value: 'invoice' } });

    await waitFor(() => {
      expect(screen.getAllByText('Cross-tenant invoice read').length).toBeGreaterThan(0);
      expect(screen.queryByText('Reflected XSS in search endpoint')).not.toBeInTheDocument();
    });
  });

  it('filters findings by state dropdown', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('Reflected XSS in search endpoint')).toBeInTheDocument();
    });

    // Find state filter select
    const stateSelect = screen.getByRole('combobox');
    fireEvent.change(stateSelect, { target: { value: 'rejected' } });

    await waitFor(() => {
      expect(screen.getAllByText('Reflected XSS in search endpoint').length).toBeGreaterThan(0);
      expect(screen.queryByText('Cross-tenant invoice read')).not.toBeInTheDocument();
    });
  });

  it('filters findings by severity pills', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getAllByText('Cross-tenant invoice read').length).toBeGreaterThan(0);
    });

    // Click "CRITICAL" severity pill
    const critBtn = screen.getByRole('button', { name: 'CRITICAL' });
    fireEvent.click(critBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Admin role escalation via weak JWT signature verification').length).toBeGreaterThan(0);
      expect(screen.queryByText('Reflected XSS in search endpoint')).not.toBeInTheDocument();
    });
  });

  it('renders detail view with security question, reproduction trace, impact, remediation, and 7-Question Gate', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('Security Question & Hypothesis')).toBeInTheDocument();
      expect(screen.getByText('Reproduction Trace')).toBeInTheDocument();
      expect(screen.getByText('Exploit Impact')).toBeInTheDocument();
      expect(screen.getByText('Remediation Guidance')).toBeInTheDocument();
      expect(screen.getByText('7-Question Validation Gate')).toBeInTheDocument();
      expect(screen.getByText('Lineage & Provenance')).toBeInTheDocument();
    });

    // Verify 7-question items
    expect(screen.getByText(/Q1:/i)).toBeInTheDocument();
    expect(screen.getByText(/Q2:/i)).toBeInTheDocument();
    expect(screen.getByText(/Q3:/i)).toBeInTheDocument();
  });

  it('renders Evidence Tray with sha256 artifact hash and copy action', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText(/Recorded Evidence Tray/i)).toBeInTheDocument();
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
      expect(screen.getAllByText(/sha256:/i).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('button', { name: /Copy/i }).length).toBeGreaterThan(0);
    });
  });

  it('displays prominent Missing Evidence warning on finding with zero evidence', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getAllByText('Candidate finding with zero recorded evidence').length).toBeGreaterThan(0);
    });

    // Select finding with 0 evidence
    fireEvent.click(screen.getAllByText('Candidate finding with zero recorded evidence')[0]);

    await waitFor(() => {
      expect(screen.getByText('Missing Recorded Evidence')).toBeInTheDocument();
      expect(screen.getByText(/Governance policy strictly blocks transition to/i)).toBeInTheDocument();
    });
  });

  it('Transition Modal allows valid promotion to validated when finding has evidence', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Transition State/i })).toBeInTheDocument();
    });

    // Open transition modal
    fireEvent.click(screen.getByRole('button', { name: /Transition State/i }));

    await waitFor(() => {
      expect(screen.getByText('Transition Finding State')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Apply Transition/i })).toBeInTheDocument();
    });

    // Submit transition
    const applyBtn = screen.getByRole('button', { name: /Apply Transition/i });
    expect(applyBtn).not.toBeDisabled();
    fireEvent.click(applyBtn);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByText('Transition Finding State')).not.toBeInTheDocument();
    });
  });

  it('Transition Modal blocks validation when finding has zero evidence', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getAllByText('Candidate finding with zero recorded evidence').length).toBeGreaterThan(0);
    });

    // Select candidate finding with 0 evidence
    fireEvent.click(screen.getAllByText('Candidate finding with zero recorded evidence')[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Transition State/i })).toBeInTheDocument();
    });

    // Open transition modal
    fireEvent.click(screen.getByRole('button', { name: /Transition State/i }));

    await waitFor(() => {
      expect(screen.getByText('Transition Finding State')).toBeInTheDocument();
      expect(screen.getByText('Validation Governance Blocked')).toBeInTheDocument();
    });

    // Verify submit button is disabled
    const applyBtn = screen.getByRole('button', { name: /Apply Transition/i });
    expect(applyBtn).toBeDisabled();
  });

  it('Transition Modal enforces mandatory reason when Rejecting a finding', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Transition State/i })).toBeInTheDocument();
    });

    // Open transition modal
    fireEvent.click(screen.getByRole('button', { name: /Transition State/i }));

    await waitFor(() => {
      expect(screen.getByText('Transition Finding State')).toBeInTheDocument();
    });

    // Select "Rejected" state
    const rejectBtn = screen.getByRole('button', { name: /^Rejected$/i });
    fireEvent.click(rejectBtn);

    await waitFor(() => {
      expect(screen.getByText(/Mandatory for Reject/i)).toBeInTheDocument();
    });

    // Apply button must be disabled with empty reason
    const applyBtn = screen.getByRole('button', { name: /Apply Transition/i });
    expect(applyBtn).toBeDisabled();

    // Fill in required reason
    const reasonTextarea = screen.getByPlaceholderText(/Required: Explain why this observation/i);
    fireEvent.change(reasonTextarea, { target: { value: 'Duplicate finding from previous assessment' } });

    // Apply button becomes enabled
    expect(applyBtn).not.toBeDisabled();
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.queryByText('Transition Finding State')).not.toBeInTheDocument();
    });
  });

  it('renders honest empty state when no findings match', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search findings, VRT, asset/i)).toBeInTheDocument();
    });

    // Search for non-existent term
    const searchInput = screen.getByPlaceholderText(/Search findings, VRT, asset/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistent-string-xyz' } });

    await waitFor(() => {
      expect(screen.getByText('No findings match')).toBeInTheDocument();
      expect(screen.getByText(/Clear all filters/i)).toBeInTheDocument();
    });
  });

  it('binds evidence with role and note, and increments evidenceVersion', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-version')).toHaveTextContent('Rev: v1');
    });

    // Click "Bind Evidence" button in Evidence Tray
    const bindBtn = screen.getByTestId('open-bind-modal-btn');
    fireEvent.click(bindBtn);

    // Modal opens
    await waitFor(() => {
      expect(screen.getByText('Bind Recorded Evidence')).toBeInTheDocument();
      expect(screen.getByText('evd_control_baseline')).toBeInTheDocument();
    });

    // Pick evd_control_baseline
    const baselineRadio = screen.getByText('evd_control_baseline');
    fireEvent.click(baselineRadio);

    // Select role: "baseline"
    const roleSelect = screen.getByLabelText(/Evidence Role/i);
    fireEvent.change(roleSelect, { target: { value: 'baseline' } });

    // Enter note
    const noteInput = screen.getByPlaceholderText(/Exact HTTP response body/i);
    fireEvent.change(noteInput, { target: { value: 'Baseline unprivileged access request' } });

    // Submit bind
    const submitBtn = screen.getByTestId('submit-bind-btn');
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // Modal closes and new binding card appears
    await waitFor(() => {
      expect(screen.queryByText('Bind Recorded Evidence')).not.toBeInTheDocument();
      expect(screen.getByText('evd_control_baseline')).toBeInTheDocument();
      expect(screen.getByTestId('role-pill-evd_control_baseline')).toHaveTextContent('Baseline');
      expect(screen.getByText(/Baseline unprivileged access request/i)).toBeInTheDocument();
      expect(screen.getByTestId('evidence-version')).toHaveTextContent('Rev: v2');
    });
  });

  it('unbounds evidence with confirmation dialog and increments evidenceVersion', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-version')).toHaveTextContent('Rev: v1');
    });

    // Click Unbind button on evd_idor_payload
    const unbindBtn = screen.getByTitle('Unbind evidence');
    fireEvent.click(unbindBtn);

    // Confirmation dialog opens
    await waitFor(() => {
      expect(screen.getByText('Unbind Evidence Artifact')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to unbind evidence/i)).toBeInTheDocument();
    });

    // Cancel first
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText('Unbind Evidence Artifact')).not.toBeInTheDocument();
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
    });

    // Click Unbind again and confirm
    fireEvent.click(screen.getByTitle('Unbind evidence'));
    await waitFor(() => {
      expect(screen.getByText('Unbind Evidence Artifact')).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Unbind' });
    fireEvent.click(confirmBtn);

    // Confirmation closes, evidence is removed, and version is incremented
    await waitFor(() => {
      expect(screen.queryByText('Unbind Evidence Artifact')).not.toBeInTheDocument();
      expect(screen.queryByText('evd_idor_payload')).not.toBeInTheDocument();
      expect(screen.getByText('Missing Recorded Evidence')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-version')).toHaveTextContent('Rev: v2');
    });
  });

  it('reorders evidence up and down and persists order', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
    });

    // First bind a second evidence item
    fireEvent.click(screen.getByTestId('open-bind-modal-btn'));
    await waitFor(() => {
      expect(screen.getByText('evd_control_baseline')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('evd_control_baseline'));
    fireEvent.click(screen.getByTestId('submit-bind-btn'));

    await waitFor(() => {
      expect(screen.getByText('evd_control_baseline')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-version')).toHaveTextContent('Rev: v2');
    });

    // Verify initial positions: evd_idor_payload is #1, evd_control_baseline is #2
    const downButtons = screen.getAllByTitle('Move Down');
    expect(downButtons[0]).not.toBeDisabled(); // first item can move down
    expect(downButtons[1]).toBeDisabled(); // last item cannot move down

    // Move first item down
    fireEvent.click(downButtons[0]);

    // Verify positions swapped and version incremented
    await waitFor(() => {
      expect(screen.getByTestId('evidence-version')).toHaveTextContent('Rev: v3');
    });

    const cards = screen.getAllByTestId(/^evidence-card-/);
    expect(cards[0]).toHaveTextContent('evd_control_baseline');
    expect(cards[1]).toHaveTextContent('evd_idor_payload');
  });

  it('evidence picker strictly lists recorded session evidence and prohibits free-text evidence IDs', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('open-bind-modal-btn'));

    await waitFor(() => {
      expect(screen.getByText('Bind Recorded Evidence')).toBeInTheDocument();
      expect(screen.getByTestId('evidence-picker-list')).toBeInTheDocument();
      expect(screen.getByText('evd_control_baseline')).toBeInTheDocument();
      expect(screen.getByText('evd_verification_diff')).toBeInTheDocument();
    });

    // Verify no free-text input exists for evidence ID
    expect(screen.queryByPlaceholderText(/evidence id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/evidence id/i)).not.toBeInTheDocument();
  });

  it('does not allow validating a finding directly from the Evidence Tray', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('Recorded Evidence Tray (1)')).toBeInTheDocument();
    });

    // Finding detail has transition button in header/actions, but Evidence Tray itself does not contain validation controls
    const trayHeader = screen.getByText(/Recorded Evidence Tray/i).closest('div');
    expect(trayHeader).toBeInTheDocument();

    // Inside the entire evidence tray container, ensure there is no "Validate" or "Mark as Validated" button
    const evidenceCards = screen.getAllByTestId(/^evidence-card-/);
    expect(evidenceCards.length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Validate Finding/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark as Validated/i })).not.toBeInTheDocument();
  });

  it('no secrets are exposed in the evidence picker', async () => {
    renderFindings();

    await waitFor(() => {
      expect(screen.getByText('evd_idor_payload')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('open-bind-modal-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('evidence-picker-list')).toBeInTheDocument();
    });

    const pickerText = screen.getByTestId('evidence-picker-list').textContent || '';
    expect(pickerText).not.toMatch(/bearer\s+[a-zA-Z0-9_\-\.]+/i);
    expect(pickerText).not.toMatch(/password/i);
    expect(pickerText).not.toMatch(/secret_key/i);
  });
});
