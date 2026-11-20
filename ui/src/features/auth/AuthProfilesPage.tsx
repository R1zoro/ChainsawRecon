import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  ArrowLeft, Plus, Search, Key, AlertCircle, RotateCw 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { AuthProfile, Paginated, ProjectSummary } from '../../api/types';
import { AuthProfileCard } from './components/AuthProfileCard';
import { DetectAuthModal } from './components/DetectAuthModal';
import { AddProfileModal } from './components/AddProfileModal';
import { LoginModal } from './components/LoginModal';

export const AuthProfilesPage: React.FC = () => {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // If no projectId in URL (e.g. accessed via /auth-profiles), fallback to prj_demo
  const projectId = routeProjectId || 'prj_demo';

  // Modals state
  const [isDetectOpen, setIsDetectOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [loginModalState, setLoginModalState] = useState<{
    profile: AuthProfile | null;
    adapter: 'http_form' | 'browser';
  }>({ profile: null, adapter: 'http_form' });

  // Pre-fill candidate from detection
  const [candidateLoginUrl, setCandidateLoginUrl] = useState('');

  // Verifying / Logging out status
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [loggingOutId, setLoggingOutId] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [conflictProfileId, setConflictProfileId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // 1. Fetch Project Metadata
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchJson<ProjectSummary>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  // 2. Fetch Auth Profiles
  const { 
    data: profilesData, 
    isLoading, 
    error: loadError, 
    refetch, 
    isFetching 
  } = useQuery({
    queryKey: ['authProfiles', projectId],
    queryFn: () => fetchJson<Paginated<AuthProfile>>(`/projects/${projectId}/auth/profiles`),
    enabled: Boolean(projectId),
  });

  const profiles = profilesData?.items || [];

  const handleVerify = async (profile: AuthProfile) => {
    setVerifyingId(profile.id);
    setActionError(null);
    try {
      await fetchJson(`/projects/${projectId}/auth/profiles/${profile.id}/verify`, {
        method: 'POST',
      });
      await queryClient.invalidateQueries({ queryKey: ['authProfiles', projectId] });
    } catch (err) {
      setActionError(isApiError(err) ? err.message : 'Verification failed.');
    } finally {
      setVerifyingId(null);
    }
  };

  const handleLogout = async (profile: AuthProfile) => {
    setLoggingOutId(profile.id);
    setActionError(null);
    try {
      await fetchJson(`/projects/${projectId}/auth/profiles/${profile.id}/logout`, {
        method: 'POST',
      });
      await queryClient.invalidateQueries({ queryKey: ['authProfiles', projectId] });
    } catch (err) {
      setActionError(isApiError(err) ? err.message : 'Logout failed.');
    } finally {
      setLoggingOutId(null);
    }
  };

  const handleRenew = async (profile: AuthProfile) => {
    setRenewingId(profile.id);
    setActionError(null);
    try {
      await fetchJson(`/projects/${projectId}/auth/profiles/${profile.id}/renew`, {
        method: 'POST',
      });
      setConflictProfileId(null);
      await queryClient.invalidateQueries({ queryKey: ['authProfiles', projectId] });
    } catch (err) {
      if (isApiError(err) && (err.code === 'CONFLICT' || err.message.includes('CONFLICT'))) {
        setConflictProfileId(profile.id);
        setActionError(err.message || 'CONFLICT: Renewal conflict. Operator login required.');
      } else {
        setActionError(isApiError(err) ? err.message : 'Renewal failed.');
      }
    } finally {
      setRenewingId(null);
    }
  };

  const handleDelete = async (profile: AuthProfile) => {
    if (!window.confirm(`Delete authentication profile "${profile.label}"?`)) {
      return;
    }
    setActionError(null);
    try {
      await fetchJson(`/projects/${projectId}/auth/profiles/${profile.id}`, {
        method: 'DELETE',
      });
      await queryClient.invalidateQueries({ queryKey: ['authProfiles', projectId] });
    } catch (err) {
      setActionError(isApiError(err) ? err.message : 'Failed to delete profile.');
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans select-none selection:bg-accent/20 selection:text-accent">
      {/* Top Header */}
      <header className="border-b border-border bg-surface shrink-0 h-14 px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(routeProjectId ? `/projects/${projectId}` : '/')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
            title="Go back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 truncate">
            <span
              onClick={() => navigate('/')}
              className="text-text-muted text-xs cursor-pointer hover:text-text"
            >
              Engagements
            </span>
            <span className="text-text-muted/50 text-xs">/</span>
            <span
              onClick={() => navigate(`/projects/${projectId}`)}
              className="text-text-muted text-xs cursor-pointer hover:text-text truncate"
            >
              {project?.name || projectId}
            </span>
            <span className="text-text-muted/50 text-xs">/</span>
            <h1 className="text-sm font-semibold text-text tracking-tight truncate flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-accent" />
              <span>Authentication Profiles</span>
            </h1>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-text-muted hover:text-text transition-colors disabled:opacity-50"
            title="Refresh profiles"
          >
            <RotateCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-accent' : ''}`} />
          </button>

          <button
            onClick={() => setIsDetectOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
            title="Scan captured traffic for authentication endpoints and bot protection"
          >
            <Search className="w-3.5 h-3.5 text-accent" />
            <span>Detect Auth</span>
          </button>

          <button
            onClick={() => {
              setCandidateLoginUrl('');
              setIsAddOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors"
            title="Create a new authentication profile"
          >
            <Plus className="w-4 h-4" />
            <span>Add Profile</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* Action Error Banner */}
        {actionError && (
          <div 
            data-testid="auth-action-error"
            className="p-3.5 rounded-lg bg-danger/10 border border-danger/30 text-danger flex items-start gap-2 text-xs"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-sans">{actionError}</div>
            <button 
              onClick={() => setActionError(null)} 
              className="text-text-muted hover:text-text"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Load Error State */}
        {loadError && (
          <div className="p-4 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to load authentication profiles</span>
            </div>
            <p className="font-sans leading-relaxed">
              {isApiError(loadError) ? loadError.message : 'Network error connecting to API.'}
            </p>
            <button
              onClick={() => refetch()}
              className="px-3 py-1 rounded bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger text-xs font-mono transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-lg bg-surface border border-border p-5 space-y-4">
                <div className="h-4 bg-surface-2 rounded w-3/4" />
                <div className="h-3 bg-surface-2 rounded w-1/2" />
                <div className="h-20 bg-surface-2 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !loadError && profiles.length === 0 && (
          <div 
            data-testid="auth-empty-state"
            className="py-16 text-center border border-dashed border-border rounded-xl bg-surface/40 max-w-xl mx-auto space-y-4 p-8"
          >
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-accent">
              <Key className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-text">No Authentication Profiles</h3>
              <p className="text-xs text-text-muted leading-relaxed font-sans max-w-md mx-auto">
                No authentication lanes or identities configured yet. Configure profiles to replay captured traffic with active sessions, or detect auth forms from traffic.
              </p>
            </div>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                onClick={() => setIsDetectOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5 text-accent" />
                <span>Detect Auth Mechanisms</span>
              </button>
              <button
                onClick={() => setIsAddOpen(true)}
                className="px-3.5 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Profile</span>
              </button>
            </div>
          </div>
        )}

        {/* Profiles Grid */}
        {!isLoading && profiles.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-text-muted font-mono">
              <span>Configured Profiles ({profiles.length})</span>
              <span className="text-[11px]">Secrets and cookies are encrypted and never shown</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {profiles.map((profile) => (
                <AuthProfileCard
                  key={profile.id}
                  profile={profile}
                  onLogin={(p, adapter) => setLoginModalState({ profile: p, adapter })}
                  onVerify={handleVerify}
                  onRenew={handleRenew}
                  onLogout={handleLogout}
                  onDelete={handleDelete}
                  isVerifying={verifyingId === profile.id}
                  isLoggingOut={loggingOutId === profile.id}
                  isRenewing={renewingId === profile.id}
                  isConflict={conflictProfileId === profile.id}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <DetectAuthModal
        projectId={projectId}
        isOpen={isDetectOpen}
        onClose={() => setIsDetectOpen(false)}
        onApplyCandidate={(candidateUrl) => {
          setCandidateLoginUrl(candidateUrl);
          setIsAddOpen(true);
        }}
      />

      <AddProfileModal
        projectId={projectId}
        isOpen={isAddOpen}
        initialLoginUrl={candidateLoginUrl}
        onClose={() => setIsAddOpen(false)}
        onProfileCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['authProfiles', projectId] });
        }}
      />

      {loginModalState.profile && (
        <LoginModal
          projectId={projectId}
          profile={loginModalState.profile}
          initialAdapter={loginModalState.adapter}
          isOpen={Boolean(loginModalState.profile)}
          onClose={() => setLoginModalState({ profile: null, adapter: 'http_form' })}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['authProfiles', projectId] });
          }}
        />
      )}
    </div>
  );
};
