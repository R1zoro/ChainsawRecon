import React from 'react';
import { Play, BookOpen, AlertOctagon, Pause, Clock, Cpu } from 'lucide-react';
import { ActiveSessionSummary } from '../../api/types';
import { formatDuration, formatRelativeTime } from '../../lib/utils';

interface ResumeBannerProps {
  session?: ActiveSessionSummary | null;
  projectName?: string;
  onResume?: (sessionId: string) => void;
  onOpenJournal?: (sessionId: string) => void;
}

export const ResumeBanner: React.FC<ResumeBannerProps> = ({
  session,
  projectName = 'Active Engagement',
  onResume,
  onOpenJournal,
}) => {
  if (!session) return null;
  if (session.status !== 'running' && session.status !== 'paused' && session.status !== 'blocked') {
    return null;
  }

  const isBlocked = session.status === 'blocked';
  const isPaused = session.status === 'paused';

  const getStatusBadge = () => {
    if (isBlocked) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-danger/20 text-danger border border-danger/30">
          <AlertOctagon className="w-3 h-3" />
          BLOCKED
        </span>
      );
    }
    if (isPaused) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-warning/20 text-warning border border-warning/30">
          <Pause className="w-3 h-3" />
          PAUSED
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-success/20 text-success border border-success/30">
        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
        RUNNING
      </span>
    );
  };

  const modelCallsUsed = session.budget?.used?.modelCalls ?? 37;

  return (
    <div className={`p-4 rounded-lg border transition-all ${
      isBlocked 
        ? 'bg-danger/10 border-danger/40' 
        : isPaused
        ? 'bg-warning/10 border-warning/40'
        : 'bg-surface border-border hover:border-accent/50'
    }`}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left Info */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-text text-sm tracking-tight">{projectName}</h3>
            <span className="text-text-muted text-xs">·</span>
            <span className="text-xs font-mono uppercase text-accent">{session.mode}</span>
            <span className="text-text-muted text-xs">·</span>
            {getStatusBadge()}
            <span className="text-text-muted text-xs">·</span>
            <span className="inline-flex items-center gap-1 text-xs font-mono text-text-muted">
              <Clock className="w-3 h-3" />
              {formatDuration(session.elapsedSeconds)}
            </span>
            <span className="text-text-muted text-xs">·</span>
            <span className="inline-flex items-center gap-1 text-xs font-mono text-text-muted">
              <Cpu className="w-3 h-3" />
              {modelCallsUsed} model calls
            </span>
          </div>

          <div className="text-xs text-text-muted flex items-center gap-2">
            <span>Last event:</span>
            <code className="text-text font-mono bg-surface-2 px-1 py-0.5 rounded border border-border">
              {session.lastEventSummary}
            </code>
            <span>·</span>
            <span>{formatRelativeTime(session.lastEventAt)}</span>
          </div>

          {isBlocked && (
            <div className="text-xs text-danger font-medium pt-1">
              Action required: {session.blockingReason || 'Human approval needed for destructive test step.'}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => onResume?.(session.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-sans transition-colors shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isPaused ? 'Resume' : isBlocked ? 'Review Block' : 'Resume'}</span>
          </button>

          <button
            onClick={() => onOpenJournal?.(session.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border font-sans transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-text-muted" />
            <span>Open journal</span>
          </button>
        </div>
      </div>
    </div>
  );
};
