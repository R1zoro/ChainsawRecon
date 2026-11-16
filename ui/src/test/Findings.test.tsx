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
});
