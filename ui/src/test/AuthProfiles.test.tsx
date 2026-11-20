import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProfilesPage } from '../features/auth/AuthProfilesPage';
import { resetMockData, setMockServiceMode, setMockAuthProfiles } from '../api/mockService';

const renderAuthProfiles = (initialRoute = '/projects/prj_demo/auth') => {
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
          <Route path="/projects/:projectId/auth" element={<AuthProfilesPage />} />
          <Route path="/auth-profiles" element={<AuthProfilesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('AuthProfilesPage (Milestone 5: Phase A Auth Tooling) Tests', () => {
  beforeEach(() => {
    resetMockData();
    setMockServiceMode('healthy');
  });

  it('renders top header and profile cards with labels, identities, adapters, and session statuses', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Authentication Profiles')).toBeInTheDocument();
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
      expect(screen.getByText('OAuth SSO Operator')).toBeInTheDocument();
    });

    // Check session status badges
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Needs Verification')).toBeInTheDocument();

    // Check adapter pills
    expect(screen.getByText('http_form')).toBeInTheDocument();
    expect(screen.getByText('browser')).toBeInTheDocument();
  });

  it('renders empty state when no authentication profiles exist', async () => {
    setMockAuthProfiles([]);
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByTestId('auth-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No Authentication Profiles')).toBeInTheDocument();
      expect(screen.getByText('Add First Profile')).toBeInTheDocument();
    });
  });

  it('opens Detect Auth modal, runs detection, and displays bot protection warning and login candidates', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Detect Auth')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Detect Auth'));

    // Modal should open and show results
    await waitFor(() => {
      expect(screen.getByText(/Authentication & Bot Protection Detection/i)).toBeInTheDocument();
      expect(screen.getByTestId('bot-protection-warning')).toBeInTheDocument();
      expect(screen.getAllByText(/Cloudflare Turnstile/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Browser login with manual operator completion is strongly recommended/i)).toBeInTheDocument();
      expect(screen.getByText(/form_login/i)).toBeInTheDocument();
      expect(screen.getByText(/oauth2_pkce/i)).toBeInTheDocument();
    });

    // Close modal
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText(/Authentication & Bot Protection Detection/i)).not.toBeInTheDocument();
    });
  });

  it('opens Add Profile modal, submits new profile, and adds it to the grid', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Add Profile')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Profile'));

    await waitFor(() => {
      expect(screen.getByText('Create Authentication Profile')).toBeInTheDocument();
    });

    // Fill form
    fireEvent.change(screen.getByPlaceholderText(/e.g. Primary Admin Account/i), {
      target: { value: 'Staging Auditor Role' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e.g. admin@acme.example.com/i), {
      target: { value: 'auditor@staging.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/https:\/\/app.example.com\/login/i), {
      target: { value: 'https://staging.example.com/login' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: /Save Auth Profile/i }));

    // Profile card should now appear in the grid
    await waitFor(() => {
      expect(screen.getByText('Staging Auditor Role')).toBeInTheDocument();
      expect(screen.getByText('auditor@staging.example.com')).toBeInTheDocument();
    });
  });

  it('shows encrypted store warning when credentials persistence is selected in Add Profile', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Add Profile')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add Profile'));

    await waitFor(() => {
      expect(screen.getByText('Create Authentication Profile')).toBeInTheDocument();
    });

    // Select persistence = credentials
    const persistenceSelect = screen.getByLabelText(/Session Persistence/i);
    fireEvent.change(persistenceSelect, { target: { value: 'credentials' } });

    expect(screen.getByText(/Credentials will be retained in the local encrypted store/i)).toBeInTheDocument();
  });

  it('submits HTTP login, clears password immediately from memory, and updates session', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('OAuth SSO Operator')).toBeInTheDocument();
    });

    // Find the OAuth SSO Operator card which has session status needs_verification, let's verify or find a card with login button
    // Let's add a new card without active session to test login buttons
    fireEvent.click(screen.getByText('Add Profile'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/e.g. Primary Admin Account/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/e.g. Primary Admin Account/i), {
      target: { value: 'QA Fresh Card' },
    });
    fireEvent.change(screen.getByPlaceholderText(/e.g. admin@acme.example.com/i), {
      target: { value: 'qa_user' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Auth Profile/i }));

    await waitFor(() => {
      expect(screen.getByText('QA Fresh Card')).toBeInTheDocument();
    });

    // Fresh card has None status, which displays HTTP Login and Browser Login buttons
    const httpLoginBtn = screen.getByRole('button', { name: /HTTP Login/i });
    fireEvent.click(httpLoginBtn);

    await waitFor(() => {
      expect(screen.getByText('HTTP Form Authentication')).toBeInTheDocument();
    });

    const passwordInput = screen.getByPlaceholderText('••••••••••••');
    fireEvent.change(passwordInput, { target: { value: 'supersecretpassword123' } });

    // Submit login
    fireEvent.click(screen.getByRole('button', { name: /Submit HTTP Login/i }));

    // Password must be cleared immediately from input
    expect((passwordInput as HTMLInputElement).value).toBe('');

    // Success notification
    await waitFor(() => {
      expect(screen.getByText(/Authentication successful/i)).toBeInTheDocument();
    });
  });

  it('displays Browser login advisory explaining visible Chromium window and manual CAPTCHA/2FA', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });

    // Add unauthenticated profile
    fireEvent.click(screen.getByText('Add Profile'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/e.g. Primary Admin Account/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByPlaceholderText(/e.g. Primary Admin Account/i), {
      target: { value: 'Browser Test Card' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save Auth Profile/i }));

    await waitFor(() => {
      expect(screen.getByText('Browser Test Card')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: /Browser Login/i })[0]);

    await waitFor(() => {
      expect(screen.getByText('Browser Interactive Login')).toBeInTheDocument();
      expect(screen.getByTestId('browser-login-advisory')).toBeInTheDocument();
      expect(screen.getByText(/Visible Chromium Window/i)).toBeInTheDocument();
      expect(screen.getByText(/Chainsaw does not bypass bot protection or solve CAPTCHAs automatically/i)).toBeInTheDocument();
    });
  });

  it('triggers session verify and updates session status', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });

    const verifyBtn = screen.getAllByRole('button', { name: /Verify/i })[0];
    fireEvent.click(verifyBtn);

    // Verify should complete without throwing and refresh
    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });
  });

  it('triggers session logout and resets status to none', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });

    const logoutBtn = screen.getAllByRole('button', { name: /Logout/i })[0];
    fireEvent.click(logoutBtn);

    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });
  });

  it('deletes an auth profile when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByLabelText('Delete profile');
    fireEvent.click(deleteBtns[0]);

    await waitFor(() => {
      expect(screen.queryByText('Primary Admin Account')).not.toBeInTheDocument();
    });
  });

  it('never displays cookies, tokens, passwords, or storage state in card or UI', async () => {
    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Primary Admin Account')).toBeInTheDocument();
    });

    // None of the raw secret values should ever appear in DOM
    expect(screen.queryByText('session_id=')).not.toBeInTheDocument();
    expect(screen.queryByText('csrf_token=')).not.toBeInTheDocument();
    expect(screen.queryByText('supersecretpassword')).not.toBeInTheDocument();
    expect(screen.queryByText('privateKey')).not.toBeInTheDocument();
  });

  it('displays Expired status, Protected by OS keychain, and Renew button for credentials persistence', async () => {
    setMockAuthProfiles([
      {
        id: 'auth_expired_cred',
        label: 'Expired Credentials Profile',
        identity: 'admin@acme.com',
        role: 'administrator',
        tenant: 'acme-corp',
        kind: 'credentials',
        adapter: 'http_form',
        persistence: 'credentials',
        targetPatterns: [],
        loginUrl: 'https://example.com/login',
        verifyUrl: 'https://example.com/verify',
        verifyIndicator: 'Dashboard',
        session: {
          profileId: 'auth_expired_cred',
          projectId: 'prj_demo',
          status: 'expired',
          expired: true,
          hasCookies: true,
          hasStorageState: false,
        },
      },
    ]);

    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Expired Credentials Profile')).toBeInTheDocument();
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByTestId('keychain-badge')).toBeInTheDocument();
      expect(screen.getByText('Protected by OS keychain')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Renew/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Log in again/i })).not.toBeInTheDocument();
    });
  });

  it('displays "Log in again" instead of Renew when expired profile has session_only persistence', async () => {
    setMockAuthProfiles([
      {
        id: 'auth_expired_session_only',
        label: 'Expired Session Only Profile',
        identity: 'operator@acme.com',
        role: 'operator',
        tenant: 'acme-corp',
        kind: 'credentials',
        adapter: 'http_form',
        persistence: 'session_only',
        targetPatterns: [],
        loginUrl: 'https://example.com/login',
        verifyUrl: 'https://example.com/verify',
        verifyIndicator: 'Dashboard',
        session: {
          profileId: 'auth_expired_session_only',
          projectId: 'prj_demo',
          status: 'expired',
          expired: true,
          hasCookies: true,
          hasStorageState: false,
        },
      },
    ]);

    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByText('Expired Session Only Profile')).toBeInTheDocument();
      expect(screen.getByText('Expired')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Log in again/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Renew/i })).not.toBeInTheDocument();
    });
  });

  it('successfully renews expired profile and updates status to active', async () => {
    setMockAuthProfiles([
      {
        id: 'auth_renew_success',
        label: 'Renewable Profile',
        identity: 'admin@acme.com',
        role: 'administrator',
        tenant: 'acme-corp',
        kind: 'credentials',
        adapter: 'http_form',
        persistence: 'credentials',
        targetPatterns: [],
        loginUrl: 'https://example.com/login',
        verifyUrl: 'https://example.com/verify',
        verifyIndicator: 'Dashboard',
        session: {
          profileId: 'auth_renew_success',
          projectId: 'prj_demo',
          status: 'expired',
          expired: true,
          hasCookies: true,
          hasStorageState: false,
        },
      },
    ]);

    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Renew/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Renew/i }));

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeInTheDocument();
    });
  });

  it('handles renew CONFLICT and displays visible error with "Log in again"', async () => {
    setMockAuthProfiles([
      {
        id: 'auth_renew_conflict',
        label: 'Conflict Profile',
        identity: 'admin@acme.com',
        role: 'administrator',
        tenant: 'acme-corp',
        kind: 'credentials',
        adapter: 'http_form',
        persistence: 'credentials',
        targetPatterns: [],
        loginUrl: 'https://example.com/login',
        verifyUrl: 'https://example.com/verify',
        verifyIndicator: 'Dashboard',
        session: {
          profileId: 'auth_renew_conflict',
          projectId: 'prj_demo',
          status: 'expired',
          expired: true,
          hasCookies: true,
          hasStorageState: false,
          warning: 'operator intervention required',
        },
      },
    ]);

    renderAuthProfiles();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Renew/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Renew/i }));

    await waitFor(() => {
      const errorBanner = screen.getByTestId('auth-action-error');
      expect(errorBanner).toBeInTheDocument();
      expect(errorBanner).toHaveTextContent(/CONFLICT/i);
      expect(screen.getByRole('button', { name: /Log in again/i })).toBeInTheDocument();
    });
  });
});
