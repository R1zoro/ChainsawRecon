import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText } from 'lucide-react';
import { fetchJson } from '../../api/client';
import { ProjectSummary, ActiveSessionSummary } from '../../api/types';
import { ReportsTab } from './ReportsTab';

export const ReportsPage: React.FC = () => {
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const projectId = routeProjectId || 'prj_demo';

  // 1. Fetch Project
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchJson<ProjectSummary>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  // 2. Fetch Sessions for this project to pick the active session
  const { data: activeSession } = useQuery({
    queryKey: ['activeSession'],
    queryFn: () => fetchJson<ActiveSessionSummary>('/sessions/active').catch(() => null),
  });

  const sessionId = activeSession?.id || 'ses_demo_01';

  return (
    <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none">
      {/* Top Bar Header */}
      <header className="h-14 border-b border-border bg-surface px-6 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="p-1.5 rounded-lg border border-border bg-bg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
            title="Return to Application Model"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-medium text-text-muted">
              {project?.name || projectId}
            </span>
            <span className="text-text-muted text-xs">/</span>
            <div className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <FileText className="w-4 h-4 text-accent" />
              <span>Assessment Reports</span>
            </div>
          </div>
        </div>
      </header>

      {/* Reports Workspace */}
      <ReportsTab sessionId={sessionId} projectId={projectId} />
    </div>
  );
};
