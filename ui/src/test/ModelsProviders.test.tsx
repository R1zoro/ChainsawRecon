import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModelsProvidersPage } from '../features/models/ModelsProvidersPage';
import { resetMockData, setMockServiceMode } from '../api/mockService';

const renderModelsProviders = () => {
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
      <MemoryRouter initialEntries={['/models']}>
        <Routes>
          <Route path="/models" element={<ModelsProvidersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('ModelsProvidersPage (Milestone 5: Phase C Web UI Provider Settings) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders top bar, architecture advisory, and provider cards', async () => {
    renderModelsProviders();

    await waitFor(() => {
      expect(screen.getByText('Models & Inference Providers')).toBeInTheDocument();
      expect(screen.getByText(/Inference Architecture & Browser Automation/i)).toBeInTheDocument();
      expect(screen.getByText('Local Ollama')).toBeInTheDocument();
      expect(screen.getByText('ChatGPT Web')).toBeInTheDocument();
      expect(screen.getByText('DeepSeek API')).toBeInTheDocument();
    });
  });

  it('adds a new Web UI provider with engine, URL, profileDir, model label, and headless switch', async () => {
    renderModelsProviders();

    await waitFor(() => {
      expect(screen.getByText('Add Provider')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Provider'));

    await waitFor(() => {
      expect(screen.getByText('Add Model / Inference Provider')).toBeInTheDocument();
      expect(screen.getByText(/Chromium Web UI Automation/i)).toBeInTheDocument();
      expect(screen.getByText(/A real Chromium browser window will launch on execution/i)).toBeInTheDocument();
    });

    // Fill provider form
    fireEvent.change(screen.getByPlaceholderText(/e.g. ChatGPT Web \(Plus\)/i), {
      target: { value: 'DeepSeek Web Operator' },
    });

    // Switch engine to DeepSeek
    const engineSelect = screen.getByDisplayValue(/ChatGPT \(OpenAI\)/i);
    fireEvent.change(engineSelect, { target: { value: 'DeepSeek' } });

    // Verify default URL changed
    expect(screen.getByDisplayValue('https://chat.deepseek.com')).toBeInTheDocument();

    // Toggle headless switch
    const headlessCheckbox = screen.getByRole('checkbox');
    fireEvent.click(headlessCheckbox);
    expect(headlessCheckbox).toBeChecked();

    // Submit provider
    fireEvent.click(screen.getByRole('button', { name: /Save Provider/i }));

    // New provider card should now be rendered in grid
    await waitFor(() => {
      expect(screen.getByText('DeepSeek Web Operator')).toBeInTheDocument();
      expect(screen.getByText('Headless')).toBeInTheDocument();
    });
  });

  it('checks provider health and displays logged-in state', async () => {
    renderModelsProviders();

    await waitFor(() => {
      expect(screen.getByText('ChatGPT Web')).toBeInTheDocument();
    });

    const checkHealthBtns = screen.getAllByRole('button', { name: /Check Health/i });
    fireEvent.click(checkHealthBtns[1]); // ChatGPT Web

    await waitFor(() => {
      expect(screen.getByText(/Operator Logged In/i)).toBeInTheDocument();
    });
  });

  it('opens Calibrate modal for Web UI provider and displays DOM selector match counts', async () => {
    renderModelsProviders();

    await waitFor(() => {
      expect(screen.getByText('ChatGPT Web')).toBeInTheDocument();
    });

    const calibrateBtn = screen.getByRole('button', { name: /Calibrate/i });
    fireEvent.click(calibrateBtn);

    await waitFor(() => {
      expect(screen.getByText('Web UI Selector Calibration')).toBeInTheDocument();
      expect(screen.getByText('DOM Selectors Match Counts')).toBeInTheDocument();
      expect(screen.getByText('input')).toBeInTheDocument();
      expect(screen.getByText('#prompt-textarea')).toBeInTheDocument();
      expect(screen.getByText('No password field (Chat active)')).toBeInTheDocument();
    });

    // Close calibrate modal
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Web UI Selector Calibration')).not.toBeInTheDocument();
    });
  });

  it('renders error state when provider loading fails', async () => {
    setMockServiceMode('error');
    renderModelsProviders();

    await waitFor(() => {
      expect(screen.getAllByText('Failed to load inference providers').length).toBeGreaterThan(0);
    });
  });
});
