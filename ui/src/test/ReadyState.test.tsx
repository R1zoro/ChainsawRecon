import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReadyStatePage } from '../features/ready-state/ReadyStatePage';
import { setMockServiceMode, resetMockData } from '../api/mockService';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <ReadyStatePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ReadyStatePage Component & Interaction Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders top bar brand and search input', async () => {
    renderWithProviders();
    expect(screen.getByText('ChainsawRecon')).toBeInTheDocument();
    expect(screen.getByText('v2 preview')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search engagements/i)).toBeInTheDocument();
  });

  it('renders Resume Banner when active session is present', async () => {
    renderWithProviders();
    await waitFor(() => {
      const elements = screen.getAllByText('Acme API');
      expect(elements.length).toBeGreaterThan(0);
    });
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(screen.getByText('Open journal')).toBeInTheDocument();
  });

  it('renders Engagements Section with cards from fixture', async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getAllByText('Acme API').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Internal QA & Staging').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Lab: Juice Shop Benchmark').length).toBeGreaterThan(0);
    });
  });

  it('filters engagements when searching', async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getAllByText('Lab: Juice Shop Benchmark').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText(/Search engagements/i);
    fireEvent.change(searchInput, { target: { value: 'Juice' } });

    await waitFor(() => {
      expect(screen.getAllByText('Lab: Juice Shop Benchmark').length).toBeGreaterThan(0);
      expect(screen.queryByText('C:/labs/acme-api')).not.toBeInTheDocument();
      expect(screen.queryByText('C:/labs/internal-qa')).not.toBeInTheDocument();
    });
  });

  it('renders Environment Subsystems panel with counts and warnings', async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText(/Environment & Subsystems/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Native OS')).toBeInTheDocument();
    expect(screen.getByText(/ChatGPT Web provider degraded/i)).toBeInTheDocument();
  });

  it('renders guided first-run empty state when no projects exist', async () => {
    setMockServiceMode('empty');
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText('Start your first engagement')).toBeInTheDocument();
    });
    expect(screen.getByText(/Prerequisites & Setup Checklist/i)).toBeInTheDocument();
    expect(screen.getByText(/1. Add a model provider/i)).toBeInTheDocument();
  });

  it('renders error state with request ID and retry button on failure', async () => {
    setMockServiceMode('error');
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText('Could not load engagements')).toBeInTheDocument();
    });
    expect(screen.getByText(/req_err_7829a1b/i)).toBeInTheDocument();
    expect(screen.getByText('Retry Connection')).toBeInTheDocument();
  });
});
