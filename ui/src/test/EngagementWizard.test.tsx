import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EngagementWizardPage } from '../features/engagement-wizard/EngagementWizardPage';
import { setMockServiceMode, resetMockData, fetchHomeData } from '../api/mockService';

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/engagements/new']}>
        <EngagementWizardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EngagementWizardPage (Milestone 0.5) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders Step 1 (Name & Workspace Folder) initially', () => {
    renderWizard();
    expect(screen.getByText('Name & Workspace Folder')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Acme API Assessment/i)).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
  });

  it('validates Step 1 requirements and blocks Next if name or folder is missing', () => {
    renderWizard();
    const nextButton = screen.getByRole('button', { name: /Next Step/i });
    fireEvent.click(nextButton);

    expect(screen.getByText('Engagement name is required.')).toBeInTheDocument();
  });

  it('progresses through wizard steps and classifies scope in Step 2', async () => {
    renderWizard();

    // Step 1: Fill name and folder
    const nameInput = screen.getByPlaceholderText(/e\.g\. Acme API Assessment/i);
    fireEvent.change(nameInput, { target: { value: 'BugBounty Target Alpha' } });

    const folderInput = screen.getByPlaceholderText(/Click Browse to select folder/i);
    fireEvent.change(folderInput, { target: { value: 'C:/engagements/target-alpha' } });

    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Step 2: Scope & Target Boundaries
    await waitFor(() => {
      expect(screen.getByText('Scope & Target Boundaries')).toBeInTheDocument();
    });

    expect(screen.getByText('In-Scope Targets')).toBeInTheDocument();
    expect(screen.getByText('Out-Of-Scope')).toBeInTheDocument();

    // Test HackerOne Format preset button
    const presetBtn = screen.getByText('HackerOne Format');
    fireEvent.click(presetBtn);

    // Step 2 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Step 3: Auth Profiles
    await waitFor(() => {
      expect(screen.getByText(/Auth Profiles & Session Lanes/i)).toBeInTheDocument();
    });

    // Check persistence selector
    expect(screen.getByText(/Credential Persistence Mode/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Save session only \(cookies\/tokens\)/i)).toBeInTheDocument();

    // Add Profile button
    const addProfileBtn = screen.getByText('Add Profile');
    fireEvent.click(addProfileBtn);
    expect(screen.getByText('Profile #2')).toBeInTheDocument();

    // Step 3 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Step 4: Scan Phases
    await waitFor(() => {
      expect(screen.getByText(/Testing Phases & Permitted Actions/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Passive Reconnaissance/i)).toBeInTheDocument();

    // Step 4 -> Step 5
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Step 5: Model Roles & Provider Gate
    await waitFor(() => {
      expect(screen.getByText(/Model Role Assignment & Provider Gate/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Orchestrator \(Planner \/ Supervisor\)/i)).toBeInTheDocument();

    // Solo Preset button
    const soloPresetBtn = screen.getByText('Solo Preset');
    fireEvent.click(soloPresetBtn);

    // Step 5 -> Step 6: Review & Launch
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    await waitFor(() => {
      expect(screen.getByText('Review Engagement Specifications')).toBeInTheDocument();
      expect(screen.getByText('BugBounty Target Alpha')).toBeInTheDocument();
    });

    // Finish wizard
    const createBtn = screen.getByText('Create Engagement');
    fireEvent.click(createBtn);

    // Verify project created in mock store
    await waitFor(async () => {
      const home = await fetchHomeData();
      expect(home.recentProjects.some((p) => p.name === 'BugBounty Target Alpha')).toBe(true);
    });
  });

  it('Provider Gate blocks progression in Step 5 when no providers are configured', async () => {
    setMockServiceMode('empty'); // Empty environment has 0 healthy/degraded providers
    renderWizard();

    // Fill step 1
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Acme API Assessment/i), {
      target: { value: 'Blocked Target' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Click Browse to select folder/i), {
      target: { value: 'C:/engagements/blocked' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Step 2 -> 3 -> 4 -> 5
    await waitFor(() => screen.getByText('Scope & Target Boundaries'));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    await waitFor(() => screen.getByText(/Auth Profiles & Session Lanes/i));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    await waitFor(() => screen.getByText(/Testing Phases & Permitted Actions/i));
    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    // Step 5: Provider Gate
    await waitFor(() => {
      expect(screen.getByText('Connect a model provider first')).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /Next Step/i });
    expect(nextBtn).toBeDisabled();
  });
});
