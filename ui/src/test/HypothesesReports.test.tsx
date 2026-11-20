import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HypothesesTab } from '../features/hypotheses/HypothesesTab';
import { ReportsTab } from '../features/reports/ReportsTab';
import { ReportsPage } from '../features/reports/ReportsPage';
import { resetMockData, setMockServiceMode } from '../api/mockService';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });

describe('Hypotheses & Reports (Milestone 6) UI Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  describe('Hypotheses Tab', () => {
    it('renders hypotheses list with title, security question, surface, and states', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <HypothesesTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Cross-tenant read on invoice endpoints')).toBeInTheDocument();
        expect(
          screen.getByText(/Can an unprivileged tenant read invoices belonging to another customer organization/i)
        ).toBeInTheDocument();
        expect(screen.getByText('GET /api/v1/invoices/{id}')).toBeInTheDocument();
        expect(screen.getByText('Reflected script execution in search query')).toBeInTheDocument();
      });

      // Verify badges
      expect(screen.getAllByText(/supported/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/rejected/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/conf: candidate/i).length).toBeGreaterThan(0);
    });

    it('creates a new hypothesis via formulation modal', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <HypothesesTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Formulate Hypothesis')).toBeInTheDocument();
      });

      // Open formulate modal
      fireEvent.click(screen.getByText('Formulate Hypothesis'));

      expect(screen.getByRole('heading', { name: /Formulate Hypothesis/i })).toBeInTheDocument();

      // Fill form
      fireEvent.change(screen.getByLabelText(/Title/i), {
        target: { value: 'Blind SQLi in user filter' },
      });
      fireEvent.change(screen.getByLabelText(/Security Question/i), {
        target: { value: 'Does the filter query string inject raw SQL in PostgreSQL query execution?' },
      });
      fireEvent.change(screen.getByLabelText(/Target Surface/i), {
        target: { value: 'GET /api/v1/users?filter=' },
      });

      // Submit
      const submitBtn = screen.getByRole('button', { name: /Create Hypothesis/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Blind SQLi in user filter')).toBeInTheDocument();
        expect(
          screen.getByText(/Does the filter query string inject raw SQL/i)
        ).toBeInTheDocument();
      });
    });

    it('transitions hypothesis state with mandatory justification reason', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <HypothesesTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Reflected script execution in search query')).toBeInTheDocument();
      });

      // Click Transition on the rejected card
      const transitionButtons = screen.getAllByRole('button', { name: /Transition/i });
      fireEvent.click(transitionButtons[0]);

      expect(screen.getByText(/Transition Hypothesis State/i)).toBeInTheDocument();

      // Record Transition button should be disabled without reason
      const recordBtn = screen.getByRole('button', { name: /Record Transition/i });
      expect(recordBtn).toBeDisabled();

      // Enter reason
      fireEvent.change(screen.getByLabelText(/Transition Justification Reason/i), {
        target: { value: 'Confirmed by independent security verification.' },
      });

      expect(recordBtn).not.toBeDisabled();

      // Submit transition
      fireEvent.click(recordBtn);

      await waitFor(() => {
        expect(screen.queryByText(/Transition Hypothesis State/i)).not.toBeInTheDocument();
      });
    });

    it('displays empty state explaining hypothesis is a security question', async () => {
      setMockServiceMode('empty');
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <HypothesesTab sessionId="ses_empty" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('No Hypotheses Recorded')).toBeInTheDocument();
        expect(
          screen.getByText(/A hypothesis is a security question, not a finding/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Reports Tab & Page', () => {
    it('report preview includes validated finding and coverage summary', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ReportsTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Session Assessment Report/i)).toBeInTheDocument();
        expect(screen.getByText(/Markdown Deliverable Preview/i)).toBeInTheDocument();
      });

      // Validated finding should be present in the generated markdown preview
      expect(
        screen.getByText(/Admin role escalation via weak JWT signature verification/i)
      ).toBeInTheDocument();

      // By default (candidate findings toggled off), candidate finding should NOT be in the table
      expect(
        screen.queryByText(/Cross-tenant invoice read/i)
      ).not.toBeInTheDocument();
    });

    it('candidate toggle changes preview and shows warning', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ReportsTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Include candidate findings/i)).toBeInTheDocument();
      });

      // Initially no candidate warning
      expect(
        screen.queryByText(/Warning: Candidate findings included/i)
      ).not.toBeInTheDocument();

      // Toggle checkbox
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // Warning banner must be visible
      await waitFor(() => {
        expect(
          screen.getByText(/Warning: Candidate findings included/i)
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Candidate findings are unverified hypotheses/i)
        ).toBeInTheDocument();
      });

      // After toggle, candidate finding should appear in preview
      await waitFor(() => {
        expect(
          screen.getByText(/Cross-tenant invoice read/i)
        ).toBeInTheDocument();
      });
    });

    it('shows coverage gap warning banner: absence of findings is not proof of clean scope', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ReportsTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(
          screen.getAllByText(/Absence of findings is not proof of clean scope/i).length
        ).toBeGreaterThan(0);
      });
    });

    it('saves report and returns artifact path with copy button', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ReportsTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Save Report/i })).toBeEnabled();
      });

      // Click Save Report
      fireEvent.click(screen.getByRole('button', { name: /Save Report/i }));

      // Artifact saved banner appears
      await waitFor(() => {
        expect(screen.getByText(/Artifact saved:/i)).toBeInTheDocument();
        expect(screen.getAllByText(/\.chainsaw\/artifacts\/report-/i).length).toBeGreaterThan(0);
      });
    });

    it('renders saved report list with download links and historical reports', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ReportsTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Previously Saved Reports/i)).toBeInTheDocument();
        expect(screen.getByText('report-20261118-142000.md')).toBeInTheDocument();
        expect(screen.getByText('.chainsaw/artifacts/report-20261118-142000.md')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download report-20261118-142000.md/i })).toBeInTheDocument();
      });

      // Click Download on saved report
      const downloadBtn = screen.getByRole('button', { name: /Download report-20261118-142000.md/i });
      fireEvent.click(downloadBtn);
    });

    it('provides Export Markdown, HTML, and JSON buttons and makes NO claims of PDF generation', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ReportsTab sessionId="ses_demo_01" projectId="prj_demo" />
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Export MD/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Export HTML/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Export JSON/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Copy MD/i })).toBeInTheDocument();
      });

      // Click each export button
      fireEvent.click(screen.getByRole('button', { name: /Export MD/i }));
      fireEvent.click(screen.getByRole('button', { name: /Export HTML/i }));
      fireEvent.click(screen.getByRole('button', { name: /Export JSON/i }));

      // Strictly verify no PDF buttons or claims exist
      expect(screen.queryByText(/Export PDF/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Download PDF/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /pdf/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/\bpdf\b/i)).not.toBeInTheDocument();
    });

    it('renders standalone ReportsPage with breadcrumb and project context', async () => {
      const queryClient = createTestQueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/projects/prj_demo/reports']}>
            <Routes>
              <Route path="/projects/:projectId/reports" element={<ReportsPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Acme API')).toBeInTheDocument();
        expect(screen.getByText('Assessment Reports')).toBeInTheDocument();
      });
    });
  });
});
