import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Play, Pause, Square, 
  RotateCw, Shield, ShieldAlert, PanelRightClose, PanelRightOpen 
} from 'lucide-react';
import { ActiveSessionSummary, SessionStatus } from '../../../api/types';

interface SessionTopBarProps {
  session?: ActiveSessionSummary | null;
  projectName?: string;
  scopeValid?: boolean | null;
  pendingApprovalsCount?: number;
  isInspectorOpen: boolean;
  onToggleInspector: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  isActionLoading?: boolean;
}

export const SessionTopBar: React.FC<SessionTopBarProps> = ({
  session,
  projectName = 'Engagement',
  scopeValid = null,
  pendingApprovalsCount = 0,
  isInspectorOpen,
  onToggleInspector,
  onStart,
  onPause,
  onResume,
  onStop,
  isActionLoading = false,
}) => {
  const navigate = useNavigate();

  const getStatusBadge = (status: SessionStatus = 'idle') => {
    switch (status) {
      case 'running':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-success/15 text-success border border-success/30">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span>RUNNING</span>
          </span>
        );
      case 'paused':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-warning/15 text-warning border border-warning/30">
            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
            <span>PAUSED</span>
          </span>
        );
      case 'blocked':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-danger/15 text-danger border border-danger/30">
            <span className="w-1.5 h-1.5 rounded-full bg-danger" />
            <span>BLOCKED</span>
          </span>
        );
      case 'completed':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-accent/15 text-accent border border-accent/30">
            <span>COMPLETED</span>
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-danger/15 text-danger border border-danger/30">
            <span>FAILED</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-surface-2 text-text-muted border border-border">
            <span>IDLE</span>
          </span>
        );
    }
  };

  const status = session?.status || 'idle';

  return (
    <header className="border-b border-border bg-surface/90 backdrop-blur h-14 px-6 flex items-center justify-between gap-4 shrink-0">
      {/* Left: Breadcrumbs & Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
          title="Return to Ready State"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 truncate">
          <span 
            className="text-text-muted text-xs truncate cursor-pointer hover:text-text" 
            onClick={() => session?.projectId ? navigate(`/projects/${session.projectId}`) : navigate('/')}
          >
            {projectName}
          </span>
          <span className="text-text-muted/50 text-xs">/</span>
          <h1 className="text-sm font-semibold text-text tracking-tight truncate font-sans">
            {session?.title || 'Session'}
          </h1>
        </div>

        {/* Status & Mode badges */}
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {getStatusBadge(status)}
          {session?.mode && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-bg border border-border text-text-muted">
              {session.mode}
            </span>
          )}
          {pendingApprovalsCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-warning/20 text-warning border border-warning/40 animate-pulse">
              <ShieldAlert className="w-3 h-3" />
              <span>{pendingApprovalsCount} Approval{pendingApprovalsCount > 1 ? 's' : ''} Pending</span>
            </span>
          )}
        </div>
      </div>

      {/* Right: Run Controls & Inspector Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Run Controls */}
        <div className="flex items-center gap-1.5 bg-bg/70 p-1 rounded-md border border-border">
          {status === 'idle' && (
            <button
              onClick={onStart}
              disabled={isActionLoading}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-40"
              title="Start session execution"
            >
              {isActionLoading ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Start</span>
            </button>
          )}

          {status === 'running' && (
            <>
              <button
                onClick={onPause}
                disabled={isActionLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border text-xs transition-colors disabled:opacity-40"
                title="Pause execution"
              >
                {isActionLoading ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                <span>Pause</span>
              </button>
              <button
                onClick={onStop}
                disabled={isActionLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30 text-xs transition-colors disabled:opacity-40"
                title="Stop session execution"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            </>
          )}

          {status === 'paused' && (
            <>
              <button
                onClick={onResume}
                disabled={isActionLoading}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-40"
                title="Resume execution"
              >
                {isActionLoading ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>Resume</span>
              </button>
              <button
                onClick={onStop}
                disabled={isActionLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30 text-xs transition-colors disabled:opacity-40"
                title="Stop session execution"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            </>
          )}

          {(status === 'completed' || status === 'failed') && (
            <button
              onClick={onStart}
              disabled={isActionLoading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 text-text-muted hover:text-text border border-border text-xs transition-colors"
              title="Restart session"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Rerun</span>
            </button>
          )}
        </div>

        {/* Scope Pill (Evidence-bound: Never fake 'Scope Enforced' without backend proof) */}
        {scopeValid === true ? (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-success/10 border border-success/30 rounded text-[11px] font-mono text-success">
            <Shield className="w-3.5 h-3.5" />
            <span>Scope Enforced</span>
          </div>
        ) : scopeValid === false ? (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-danger/10 border border-danger/30 rounded text-[11px] font-mono text-danger">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Scope Invalid</span>
          </div>
        ) : (
          <div 
            onClick={() => navigate('/settings')}
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-surface-2/60 border border-border rounded text-[11px] font-mono text-text-muted hover:text-text cursor-pointer transition-colors"
            title="Scope policy status unconfirmed. Click to inspect settings."
          >
            <Shield className="w-3.5 h-3.5 text-text-muted" />
            <span>Scope: Unknown</span>
          </div>
        )}

        {/* Inspector Toggle */}
        <button
          onClick={onToggleInspector}
          className={`p-2 rounded border border-border transition-colors ${
            isInspectorOpen
              ? 'bg-surface-2 text-text'
              : 'bg-surface text-text-muted hover:text-text hover:bg-surface-2'
          }`}
          title={isInspectorOpen ? 'Collapse Inspector' : 'Expand Inspector'}
        >
          {isInspectorOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
};
