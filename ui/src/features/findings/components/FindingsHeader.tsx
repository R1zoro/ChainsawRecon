import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, ShieldAlert, Terminal, Layers, ArrowLeft, RefreshCw } from 'lucide-react';
import { ProjectSummary, ProjectScopeResponse } from '../../../api/types';

interface FindingsHeaderProps {
  project?: ProjectSummary;
  scopeData?: ProjectScopeResponse;
  projectId: string;
  totalFindings: number;
  candidateCount: number;
  validatedCount: number;
  rejectedCount: number;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const FindingsHeader: React.FC<FindingsHeaderProps> = ({
  project,
  scopeData,
  projectId,
  totalFindings,
  candidateCount,
  validatedCount,
  rejectedCount,
  onRefresh,
  isRefreshing = false,
}) => {
  const scopeStatus = project?.scopeStatus || (scopeData?.valid ? 'ok' : 'invalid');

  return (
    <header className="h-14 border-b border-border bg-surface px-4 flex items-center justify-between font-sans select-none shrink-0">
      {/* Left: Breadcrumbs & Scope Pill */}
      <div className="flex items-center gap-3">
        <Link
          to={`/projects/${projectId}`}
          className="p-1.5 rounded-lg border border-border bg-bg hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
          title="Return to Application Model"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-medium text-text-muted">
            {project?.name || projectId || 'Project'}
          </span>
          <span className="text-text-muted text-xs">/</span>
          <h1 className="text-sm font-semibold text-text tracking-tight">
            Security Findings
          </h1>
        </div>

        {/* Scope Policy Badge */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${
            scopeStatus === 'ok'
              ? 'bg-success/10 border-success/30 text-success'
              : scopeStatus === 'empty'
              ? 'bg-warning/10 border-warning/30 text-warning'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
          title="Engagement Scope Enforcement State"
        >
          {scopeStatus === 'ok' ? (
            <Shield className="w-3.5 h-3.5" />
          ) : (
            <ShieldAlert className="w-3.5 h-3.5" />
          )}
          <span className="text-[11px] font-semibold">
            {scopeStatus === 'ok' ? 'Scope: Enforced' : 'Scope: Unknown / Warning'}
          </span>
        </div>
      </div>

      {/* Center: Stat Badges */}
      <div className="hidden md:flex items-center gap-2 text-xs font-mono">
        <span className="px-2 py-0.5 rounded bg-bg border border-border text-text-muted">
          Total: <strong className="text-text">{totalFindings}</strong>
        </span>
        <span className="px-2 py-0.5 rounded bg-warning/10 border border-warning/30 text-warning">
          Candidate: <strong>{candidateCount}</strong>
        </span>
        <span className="px-2 py-0.5 rounded bg-success/10 border border-success/30 text-success">
          Validated: <strong>{validatedCount}</strong>
        </span>
        <span className="px-2 py-0.5 rounded bg-danger/10 border border-danger/30 text-danger">
          Rejected: <strong>{rejectedCount}</strong>
        </span>
      </div>

      {/* Right: Quick Links & Refresh */}
      <div className="flex items-center gap-2">
        <Link
          to={`/projects/${projectId}/workbench`}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-bg hover:bg-surface-2 text-xs text-text transition-colors"
          title="Open HTTP Workbench"
        >
          <Terminal className="w-3.5 h-3.5 text-accent" />
          <span>Workbench</span>
        </Link>

        <Link
          to={`/projects/${projectId}`}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-bg hover:bg-surface-2 text-xs text-text transition-colors"
          title="Open Application Model Graph"
        >
          <Layers className="w-3.5 h-3.5 text-text-muted" />
          <span>App Model</span>
        </Link>

        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded-lg border border-border bg-bg hover:bg-surface-2 text-text-muted hover:text-text transition-colors disabled:opacity-50"
          title="Refresh Findings"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-accent' : ''}`} />
        </button>
      </div>
    </header>
  );
};
