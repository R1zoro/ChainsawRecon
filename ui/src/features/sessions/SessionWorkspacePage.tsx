import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, RotateCw, Copy, Check } from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { eventClient, ConnectionState } from '../../api/events';
import { 
  ActiveSessionSummary, 
  JournalEvent, 
  JournalResponse, 
  SessionContextResponse, 
  Paginated, 
  TaskItem, 
  ApprovalItem,
  EvidenceItem,
  ProjectSummary,
  ProjectScopeResponse
} from '../../api/types';
import { SessionTopBar } from './components/SessionTopBar';
import { SessionLeftPanel } from './components/SessionLeftPanel';
import { JournalTimeline } from './components/JournalTimeline';
import { OperatorComposer } from './components/OperatorComposer';
import { SessionInspector } from './components/SessionInspector';
import { SessionStatusBar } from './components/SessionStatusBar';

export const SessionWorkspacePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Selected event for inspector
  const [selectedEvent, setSelectedEvent] = useState<JournalEvent | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);

  // Connection & Seq State
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [lastSeq, setLastSeq] = useState<number>(0);
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copiedRequestId, setCopiedRequestId] = useState(false);

  // 1. Fetch Session Metadata
  const { data: session, isLoading: isSessionLoading, error: sessionError, refetch: refetchSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchJson<ActiveSessionSummary>(`/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
    retry: false,
  });

  // 2. Fetch Project Metadata (to display real project name instead of hardcoded)
  const { data: projectData } = useQuery({
    queryKey: ['project', session?.projectId],
    queryFn: () => fetchJson<ProjectSummary>(`/projects/${session?.projectId}`),
    enabled: Boolean(session?.projectId),
  });

  // 3. Fetch Scope Policy Status (evidence-based scope status)
  const { data: scopeData } = useQuery({
    queryKey: ['projectScope', session?.projectId],
    queryFn: () => fetchJson<ProjectScopeResponse>(`/projects/${session?.projectId}/scope`),
    enabled: Boolean(session?.projectId),
  });

  // 4. Fetch Session Context
  const { data: contextData } = useQuery({
    queryKey: ['sessionContext', sessionId],
    queryFn: () => fetchJson<SessionContextResponse>(`/sessions/${sessionId}/context`),
    enabled: Boolean(sessionId),
  });

  // 5. Fetch Tasks
  const { data: tasksData } = useQuery({
    queryKey: ['sessionTasks', sessionId],
    queryFn: () => fetchJson<Paginated<TaskItem>>(`/sessions/${sessionId}/tasks`),
    enabled: Boolean(sessionId),
  });

  // 6. Fetch Approvals
  const { data: approvalsData } = useQuery({
    queryKey: ['sessionApprovals', sessionId],
    queryFn: () => fetchJson<Paginated<ApprovalItem>>(`/sessions/${sessionId}/approvals`),
    enabled: Boolean(sessionId),
  });

  // 7. Fetch Evidence Projection Records
  const { data: evidenceData } = useQuery({
    queryKey: ['sessionEvidence', sessionId],
    queryFn: () => fetchJson<Paginated<EvidenceItem>>(`/sessions/${sessionId}/evidence`),
    enabled: Boolean(sessionId),
  });

  // 8. Initial Journal History Fetch
  const fetchJournalHistory = useCallback(async (after = 0) => {
    if (!sessionId) return;
    try {
      const res = await fetchJson<JournalResponse>(`/sessions/${sessionId}/journal?afterSeq=${after}&limit=100`);
      if (res?.items) {
        setEvents((prev) => {
          const map = new Map<number, JournalEvent>();
          prev.forEach((e) => map.set(e.seq, e));
          res.items.forEach((e) => map.set(e.seq, e));
          const merged = Array.from(map.values()).sort((a, b) => a.seq - b.seq);
          if (merged.length > 0) {
            setLastSeq((curr) => Math.max(curr, merged[merged.length - 1].seq));
          }
          return merged;
        });
      }
    } catch (err) {
      console.warn('[SessionWorkspace] Initial journal load error', err);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchJournalHistory(0);
  }, [fetchJournalHistory]);

  // 9. Real-time WebSocket connection and events handling
  useEffect(() => {
    if (!sessionId) return;

    const unsubState = eventClient.onStateChange((state) => {
      setConnectionState(state);
    });

    const unsubEvent = eventClient.subscribe((event) => {
      setEvents((prev) => {
        if (prev.some((e) => e.seq === event.seq)) return prev;
        const next = [...prev, event].sort((a, b) => a.seq - b.seq);
        setLastSeq(event.seq);
        return next;
      });
    });

    const unsubGap = eventClient.onGap((gapFrom) => {
      fetchJournalHistory(gapFrom);
    });

    eventClient.connect(sessionId, lastSeq);

    return () => {
      unsubState();
      unsubEvent();
      unsubGap();
      eventClient.disconnect();
    };
  }, [sessionId, fetchJournalHistory]);

  // 10. Elapsed time tracker
  useEffect(() => {
    if (session?.elapsedSeconds !== undefined) {
      setElapsedSeconds(session.elapsedSeconds);
    }
  }, [session?.elapsedSeconds]);

  useEffect(() => {
    if (session?.status !== 'running') return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [session?.status]);

  // 11. Run controls handlers
  const handleRunAction = async (action: 'start' | 'pause' | 'resume' | 'stop') => {
    if (!sessionId || isActionLoading) return;
    setIsActionLoading(true);
    try {
      await fetchJson<ActiveSessionSummary>(`/sessions/${sessionId}/${action}`, {
        method: 'POST',
      });
      await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    } catch (err) {
      console.error(`[SessionWorkspace] Failed to ${action} session`, err);
    } finally {
      setIsActionLoading(false);
    }
  };

  // 12. Send operator message
  const handleSendMessage = async (content: string, interrupt: boolean) => {
    if (!sessionId) return;
    await fetchJson<{ seq: number; status: string }>(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, interrupt }),
    });
    await fetchJournalHistory(lastSeq);
  };

  // 13. Approval Grant and Deny handlers
  const handleGrantApproval = async (approvalId: string, reason: string) => {
    if (!sessionId) return;
    await fetchJson<ApprovalItem>(`/sessions/${sessionId}/approvals/${approvalId}/grant`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await queryClient.invalidateQueries({ queryKey: ['sessionApprovals', sessionId] });
    await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    await fetchJournalHistory(lastSeq);
  };

  const handleDenyApproval = async (approvalId: string, reason: string) => {
    if (!sessionId) return;
    await fetchJson<ApprovalItem>(`/sessions/${sessionId}/approvals/${approvalId}/deny`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await queryClient.invalidateQueries({ queryKey: ['sessionApprovals', sessionId] });
    await queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    await fetchJournalHistory(lastSeq);
  };

  const handleSelectEvent = (event: JournalEvent) => {
    setSelectedEvent(event);
    if (!isInspectorOpen) {
      setIsInspectorOpen(true);
    }
  };

  const handleSelectEvidence = (item: EvidenceItem) => {
    const matchingEvt = events.find((e) => {
      if (typeof e.data === 'object' && e.data !== null) {
        const d = e.data as Record<string, unknown>;
        return d.artifactId === item.artifactId || d.evidenceId === item.id || d.id === item.id;
      }
      return false;
    });

    if (matchingEvt) {
      handleSelectEvent(matchingEvt);
    } else {
      setSelectedEvent({
        seq: lastSeq,
        ts: item.createdAt,
        sessionId: sessionId || '',
        type: `evidence/${item.kind}`,
        actor: 'operator',
        data: item as unknown as Record<string, unknown>,
      });
      setIsInspectorOpen(true);
    }
  };

  // Structured skeleton loading layout
  if (isSessionLoading) {
    return (
      <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none animate-pulse">
        <header className="border-b border-border bg-surface h-14 px-6 flex items-center justify-between">
          <div className="h-4 w-48 bg-surface-2 rounded" />
          <div className="h-7 w-32 bg-surface-2 rounded" />
        </header>
        <div className="flex-1 flex min-h-0">
          <div className="w-80 border-r border-border bg-surface p-4 space-y-4">
            <div className="h-20 bg-surface-2 rounded" />
            <div className="h-32 bg-surface-2 rounded" />
            <div className="h-40 bg-surface-2 rounded" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <div className="h-10 bg-surface rounded" />
            <div className="h-24 bg-surface rounded" />
            <div className="h-24 bg-surface rounded" />
          </div>
          <div className="w-96 border-l border-border bg-surface p-4">
            <div className="h-64 bg-surface-2 rounded" />
          </div>
        </div>
      </div>
    );
  }

  // Structured ApiError state display
  if (sessionError) {
    const apiErr = isApiError(sessionError) ? sessionError : null;
    const errorCode = apiErr?.code || 'SESSION_LOAD_FAILED';
    const requestId = apiErr?.request_id || 'unknown';
    const errorMessage = apiErr?.message || (sessionError instanceof Error ? sessionError.message : 'Session not found');

    return (
      <div className="min-h-screen bg-bg text-text flex flex-col items-center justify-center font-mono text-xs p-6 space-y-4">
        <div className="max-w-md w-full p-5 rounded-lg bg-surface border border-danger/40 space-y-3">
          <div className="flex items-center gap-2 text-danger font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Failed to load session ({errorCode})</span>
          </div>

          <p className="text-text-muted text-xs leading-relaxed font-sans">
            {errorMessage}
          </p>

          <div className="flex items-center justify-between p-2 rounded bg-bg border border-border text-[11px] text-text-muted">
            <span>Request ID: <span className="text-text select-all">{requestId}</span></span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(requestId);
                setCopiedRequestId(true);
                setTimeout(() => setCopiedRequestId(false), 2000);
              }}
              className="p-1 hover:text-text rounded transition-colors"
              title="Copy Request ID"
            >
              {copiedRequestId ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1.5 rounded bg-surface-2 border border-border text-text hover:bg-surface-2/80 transition-colors"
            >
              Ready State
            </button>
            <button
              onClick={() => refetchSession()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const projectName = projectData?.name || session?.title || 'Engagement';
  const scopeValid = scopeData?.valid ?? null;
  const pendingApprovalsCount = approvalsData?.items?.filter((a) => a.status === 'pending').length || 0;
  const evidenceItems = evidenceData?.items || [];

  return (
    <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none selection:bg-accent/20 selection:text-accent">
      {/* 1. Top Bar */}
      <SessionTopBar
        session={session}
        projectName={projectName}
        scopeValid={scopeValid}
        pendingApprovalsCount={pendingApprovalsCount}
        isInspectorOpen={isInspectorOpen}
        onToggleInspector={() => setIsInspectorOpen(!isInspectorOpen)}
        onStart={() => handleRunAction('start')}
        onPause={() => handleRunAction('pause')}
        onResume={() => handleRunAction('resume')}
        onStop={() => handleRunAction('stop')}
        isActionLoading={isActionLoading}
      />

      {/* 2. Three Column Work Surface */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Column: Context, Tasks, Approvals, Budget, Evidence */}
        <SessionLeftPanel
          session={session}
          contextData={contextData}
          tasks={tasksData?.items || []}
          approvals={approvalsData?.items || []}
          evidenceItems={evidenceItems}
          targets={session?.targets && session.targets.length > 0 ? session.targets : projectData?.targets}
          onSelectEvidence={handleSelectEvidence}
          onGrantApproval={handleGrantApproval}
          onDenyApproval={handleDenyApproval}
        />

        {/* Center Column: Live Journal Timeline + Operator Composer */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg overflow-hidden">
          <JournalTimeline
            events={events}
            selectedEvent={selectedEvent}
            onSelectEvent={handleSelectEvent}
          />

          <OperatorComposer
            onSendMessage={handleSendMessage}
            disabled={session?.status === 'completed' || session?.status === 'failed'}
          />
        </div>

        {/* Right Column: Inspector Panel */}
        {isInspectorOpen && (
          <SessionInspector
            selectedEvent={selectedEvent}
            contextData={contextData}
            onClose={() => setIsInspectorOpen(false)}
          />
        )}
      </div>

      {/* 3. Bottom Status Bar */}
      <SessionStatusBar
        connectionState={connectionState}
        lastSeq={lastSeq}
        sandbox="native"
        elapsedSeconds={elapsedSeconds}
        scopeValid={scopeData?.valid}
      />
    </div>
  );
};
