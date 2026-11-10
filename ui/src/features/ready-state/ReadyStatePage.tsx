import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  FolderPlus, FolderOpen, AlertOctagon, RotateCw, 
  WifiOff, Square 
} from 'lucide-react';
import { fetchJson, isApiError, getMockServiceMode, setMockServiceMode } from '../../api/client';
import { HomeDataResponse, MockServiceMode, ProjectSummary } from '../../api/types';
import { TopBar } from '../../components/TopBar';
import { TopMenuBar } from '../../components/TopMenuBar';
import { Footer } from '../../components/Footer';
import { ReadyStateSkeleton } from '../../components/skeletons/ReadyStateSkeleton';
import { ResumeBanner } from './ResumeBanner';
import { EngagementsSection } from './EngagementsSection';
import { RecentActivity } from './RecentActivity';
import { EnvironmentPanel } from './EnvironmentPanel';
import { OpenFolderModal } from '../../components/modals/OpenFolderModal';
import { ImportModal } from '../../components/modals/ImportModal';
import { useKeyboardShortcuts } from '../../lib/useKeyboardShortcuts';

export const ReadyStatePage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMode, setCurrentMode] = useState<MockServiceMode>(getMockServiceMode());
  const [isOpenFolderModalOpen, setIsOpenFolderModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // TanStack Query
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['homeData', currentMode],
    queryFn: () => fetchJson<HomeDataResponse>('/home'),
    retry: false,
  });

  // Global hotkeys
  useKeyboardShortcuts({
    onNewEngagement: () => navigate('/engagements/new'),
    onOpenFolder: () => setIsOpenFolderModalOpen(true),
    onResumeSession: () => {
      if (data?.activeSession?.id) {
        navigate(`/sessions/${data.activeSession.id}`);
      }
    },
    onCommandPalette: () => {
      navigate('/settings');
    },
  });

  const handleModeChange = (mode: MockServiceMode) => {
    setCurrentMode(mode);
    setMockServiceMode(mode);
    queryClient.invalidateQueries({ queryKey: ['homeData'] });
  };

  const handleResume = (sessionId: string) => {
    navigate(`/sessions/${sessionId}`);
  };

  const handleOpenJournal = (sessionId: string) => {
    navigate(`/sessions/${sessionId}?tab=journal`);
  };

  const handleOpenFolder = async (path: string) => {
    await fetchJson<ProjectSummary>('/projects/open', {
      method: 'POST',
      body: JSON.stringify({ path, initialize: true }),
    });
    queryClient.invalidateQueries({ queryKey: ['homeData'] });
  };

  const handleRemoveProject = async (id: string) => {
    await fetchJson<void>(`/projects/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: ['homeData'] });
  };

  const handleArchiveProject = async (id: string) => {
    await fetchJson<void>(`/projects/${id}/archive`, { method: 'POST' });
    queryClient.invalidateQueries({ queryKey: ['homeData'] });
  };

  // State 5: Disconnected
  const isDisconnected = currentMode === 'disconnected' || (error instanceof Error && error.message === 'NETWORK_DISCONNECTED');

  const getErrorMessage = () => {
    if (isApiError(error)) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'An unexpected error occurred while communicating with the local API service.';
  };

  const getErrorCode = () => {
    if (isApiError(error)) {
      return error.code;
    }
    return 'FETCH_ERROR';
  };

  const getRequestId = () => {
    if (isApiError(error)) {
      return error.request_id;
    }
    return 'req_unknown';
  };

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans selection:bg-accent/20 selection:text-accent">
      <TopMenuBar />

      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        environment={data?.environment}
        onModeChange={handleModeChange}
        currentMode={currentMode}
        onOpenSettings={() => navigate('/settings')}
      />

      {/* Disconnected State Top Banner */}
      {isDisconnected && (
        <div className="bg-danger/20 border-b border-danger/40 px-6 py-2.5 text-xs text-danger flex items-center justify-between">
          <div className="max-w-[1200px] mx-auto w-full flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4" />
              <span className="font-semibold">Local API disconnected.</span>
              <span className="text-text-muted">Reconnecting... Changes are temporarily disabled.</span>
            </div>
            <button
              onClick={() => {
                handleModeChange('healthy');
                refetch();
              }}
              className="px-2.5 py-1 rounded bg-danger text-white text-[11px] font-medium hover:bg-danger/90 transition-colors flex items-center gap-1"
            >
              <RotateCw className="w-3 h-3" />
              Reconnect Now
            </button>
          </div>
        </div>
      )}

      {/* Main Canvas Container (Max 1200px, 24px padding) */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-8 space-y-8">
        {/* State 1: Loading Skeleton */}
        {isLoading ? (
          <ReadyStateSkeleton />
        ) : isError && !isDisconnected ? (
          /* State 3: Error State with Persistent Code & Request ID */
          <div className="rounded-lg border border-danger/40 bg-danger/10 p-6 space-y-4 text-center max-w-lg mx-auto my-12">
            <AlertOctagon className="w-10 h-10 text-danger mx-auto" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-text">Could not load engagements</h2>
              <p className="text-xs text-text-muted">{getErrorMessage()}</p>
            </div>

            <div className="p-2.5 rounded bg-bg/80 border border-border font-mono text-[11px] text-left text-text-muted space-y-1">
              <div>Code: <strong className="text-danger font-normal">{getErrorCode()}</strong></div>
              <div>Request ID: <strong className="text-text font-normal">{getRequestId()}</strong></div>
            </div>

            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-accent text-[#0D1015] font-medium text-xs hover:bg-accent-hover transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Retry Connection
            </button>
          </div>
        ) : data && data.recentProjects.length === 0 ? (
          /* State 2: Guided First-Run Empty State */
          <div className="space-y-10 max-w-2xl mx-auto py-8">
            <div className="text-center space-y-3">
              <span className="text-4xl block">⛓️</span>
              <h2 className="text-xl font-semibold text-text tracking-tight">Start your first engagement</h2>
              <p className="text-xs text-text-muted max-w-md mx-auto leading-relaxed">
                Pick a folder, define authorized scope boundaries, and choose how the agent authenticates against your target application.
              </p>

              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  disabled={isDisconnected}
                  onClick={() => navigate('/engagements/new')}
                  className="flex items-center gap-2 px-4 py-2 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors shadow-sm disabled:opacity-50"
                >
                  <FolderPlus className="w-4 h-4" />
                  New engagement
                </button>

                <button
                  disabled={isDisconnected}
                  onClick={() => setIsOpenFolderModalOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border text-xs transition-colors disabled:opacity-50"
                >
                  <FolderOpen className="w-4 h-4 text-text-muted" />
                  Open existing folder
                </button>
              </div>
            </div>

            {/* Guided Setup Checklist */}
            <div className="rounded-lg border border-border bg-surface p-5 space-y-3 text-xs">
              <h3 className="font-semibold text-text text-sm">Prerequisites & Setup Checklist</h3>
              <div className="space-y-2 font-mono text-[11px]">
                <div className="flex items-center justify-between p-2 rounded bg-bg/80 border border-border/60">
                  <span className="flex items-center gap-2 text-text">
                    <Square className="w-3.5 h-3.5 text-text-muted" />
                    1. Add a model provider (Ollama, Groq, or OpenAI-compatible)
                  </span>
                  <button
                    onClick={() => navigate('/models')}
                    className="text-warning hover:underline text-[10px]"
                  >
                    Configure &rarr;
                  </button>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-bg/80 border border-border/60">
                  <span className="flex items-center gap-2 text-text">
                    <Square className="w-3.5 h-3.5 text-text-muted" />
                    2. Install security tool packs (httpx, katana, nuclei)
                  </span>
                  <button
                    onClick={() => navigate('/tools')}
                    className="text-warning hover:underline text-[10px]"
                  >
                    Install &rarr;
                  </button>
                </div>
                <div className="flex items-center justify-between p-2 rounded bg-bg/80 border border-border/60">
                  <span className="flex items-center gap-2 text-text">
                    <Square className="w-3.5 h-3.5 text-text-muted" />
                    3. Configure target auth profile (cookies or credentials)
                  </span>
                  <button
                    onClick={() => navigate('/auth-profiles')}
                    className="text-text-muted hover:underline text-[10px]"
                  >
                    Setup &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Healthy / Partial State */
          <>
            {/* Resume Banner */}
            {data?.activeSession && (
              <ResumeBanner
                session={data.activeSession}
                projectName={data.recentProjects.find(p => p.id === data.activeSession?.projectId)?.name}
                onResume={handleResume}
                onOpenJournal={handleOpenJournal}
              />
            )}

            {/* Engagements Section */}
            <EngagementsSection
              projects={data?.recentProjects ?? []}
              searchQuery={searchQuery}
              onOpenFolderModal={() => setIsOpenFolderModalOpen(true)}
              onOpenImportModal={() => setIsImportModalOpen(true)}
              onArchiveProject={handleArchiveProject}
              onRemoveProject={handleRemoveProject}
            />

            {/* Bottom Grid: Recent Activity & Subsystems Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
              <RecentActivity
                activity={data?.recentActivity ?? []}
                onSelectActivity={(act) => navigate(`/projects/${act.projectId}`)}
              />

              <EnvironmentPanel
                environment={data?.environment}
                onNavigateTo={(sec) => navigate(`/${sec}`)}
              />
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      <OpenFolderModal
        isOpen={isOpenFolderModalOpen}
        onClose={() => setIsOpenFolderModalOpen(false)}
        onOpen={handleOpenFolder}
      />

      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={async (type, content) => {
          console.log(`Imported ${type} with length ${content.length}`);
          queryClient.invalidateQueries({ queryKey: ['homeData'] });
        }}
      />

      {/* Keyboard Shortcuts Modal */}
      {isShortcutsOpen && (
        <div className="fixed inset-0 bg-[#0D1015]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-2xl p-5 space-y-4 font-sans text-xs">
            <h3 className="font-semibold text-text text-sm">Keyboard Shortcuts</h3>
            <div className="space-y-2 font-mono text-[11px] divide-y divide-border/60">
              <div className="flex justify-between py-1.5">
                <span className="text-text-muted">Focus Search</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text">/</kbd>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text-muted">New Engagement</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text">n</kbd>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text-muted">Open Folder</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text">o</kbd>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text-muted">Resume Active Scan</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text">r</kbd>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-text-muted">Command Palette / Settings</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text">Ctrl+K</kbd>
              </div>
            </div>
            <button
              onClick={() => setIsShortcutsOpen(false)}
              className="w-full py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border transition-colors font-medium mt-2"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <Footer onOpenShortcuts={() => setIsShortcutsOpen(true)} />
    </div>
  );
};
