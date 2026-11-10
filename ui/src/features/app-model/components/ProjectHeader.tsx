import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Copy, Check, Shield, ShieldAlert, 
  Network, Table, Download, RotateCw, Play, AlertTriangle, Terminal 
} from 'lucide-react';
import { ProjectSummary, ProjectScopeResponse, ActiveSessionSummary } from '../../../api/types';

export type AppModelViewTab = 'graph' | 'table';

interface ProjectHeaderProps {
  project?: ProjectSummary | null;
  scopeData?: ProjectScopeResponse | null;
  activeSession?: ActiveSessionSummary | null;
  activeTab: AppModelViewTab;
  onChangeTab: (tab: AppModelViewTab) => void;
  staleCount: number;
  isStaleFilterActive: boolean;
  onToggleStaleFilter: () => void;
  onRefresh: () => void;
  onExportJson: () => void;
  isRefreshing?: boolean;
}

export const ProjectHeader: React.FC<ProjectHeaderProps> = ({
  project,
  scopeData,
  activeSession,
  activeTab,
  onChangeTab,
  staleCount,
  isStaleFilterActive,
  onToggleStaleFilter,
  onRefresh,
  onExportJson,
  isRefreshing = false,
}) => {
  const navigate = useNavigate();
  const [copiedPath, setCopiedPath] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const coverage = project?.coverage || {
    applications: 0,
    services: 0,
    routes: 0,
    inputs: 0,
    identities: 0,
    staleAssets: 0,
  };

  const handleCopyPath = () => {
    if (!project?.path) return;
    navigator.clipboard.writeText(project.path);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  return (
    <header className="border-b border-border bg-surface shrink-0 select-none font-sans">
      {/* Top Row: Navigation, Title, Badges, Actions */}
      <div className="h-14 px-6 flex items-center justify-between gap-4">
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
              onClick={() => navigate('/')}
              className="text-text-muted text-xs truncate cursor-pointer hover:text-text"
            >
              Engagements
            </span>
            <span className="text-text-muted/50 text-xs">/</span>
            <h1 className="text-sm font-semibold text-text tracking-tight truncate">
              {project?.name || 'Project Overview'}
            </h1>
          </div>

          {/* Directory Path */}
          {project?.path && (
            <div 
              onClick={handleCopyPath}
              className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-bg border border-border text-[11px] font-mono text-text-muted hover:text-text cursor-pointer transition-colors max-w-xs truncate"
              title="Click to copy filesystem path"
            >
              <span className="truncate">{project.path}</span>
              {copiedPath ? <Check className="w-3 h-3 text-success shrink-0" /> : <Copy className="w-3 h-3 text-text-muted/60 shrink-0" />}
            </div>
          )}

          {/* Scope Policy Badge */}
          {scopeData?.valid === true ? (
            <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 bg-success/10 border border-success/30 rounded text-[10px] font-mono text-success">
              <Shield className="w-3 h-3" />
              <span>Scope Enforced</span>
            </div>
          ) : scopeData?.valid === false ? (
            <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 bg-danger/10 border border-danger/30 rounded text-[10px] font-mono text-danger">
              <ShieldAlert className="w-3 h-3" />
              <span>Scope Invalid</span>
            </div>
          ) : (
            <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 bg-surface-2 text-text-muted border border-border rounded text-[10px] font-mono">
              <Shield className="w-3 h-3 text-text-muted" />
              <span>Scope: Unknown</span>
            </div>
          )}
        </div>

        {/* Right: Active Session CTA, View Switcher & Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Active Session Quick Link */}
          {activeSession && (
            <button
              onClick={() => navigate(`/sessions/${activeSession.id}`)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 border border-accent/30 text-xs font-mono font-medium transition-colors"
              title="Jump to active execution session"
            >
              <Play className="w-3 h-3 fill-current animate-pulse" />
              <span>Resume Session</span>
            </button>
          )}

          {/* View Switcher (Graph vs Table) */}
          <div className="flex items-center bg-bg p-0.5 rounded-lg border border-border">
            <button
              onClick={() => onChangeTab('graph')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'graph'
                  ? 'bg-surface-2 text-text shadow-sm border border-border'
                  : 'text-text-muted hover:text-text'
              }`}
              title="Interactive topology graph view"
            >
              <Network className="w-3.5 h-3.5" />
              <span>Graph</span>
            </button>
            <button
              onClick={() => onChangeTab('table')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                activeTab === 'table'
                  ? 'bg-surface-2 text-text shadow-sm border border-border'
                  : 'text-text-muted hover:text-text'
              }`}
              title="Authoritative inventory table view"
            >
              <Table className="w-3.5 h-3.5" />
              <span>Table</span>
            </button>
          </div>

          {/* Refresh Action */}
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text-muted hover:text-text transition-colors disabled:opacity-40"
            title="Refresh application model data"
          >
            <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-accent' : ''}`} />
          </button>

          {/* Open Workbench */}
          <button
            onClick={() => project && navigate(`/projects/${project.id}/workbench`)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
            title="Open HTTP Workbench"
          >
            <Terminal className="w-3.5 h-3.5 text-accent" />
            <span>Workbench</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
              title="Export application model"
            >
              <Download className="w-3.5 h-3.5 text-text-muted" />
              <span>Export</span>
            </button>

            {isExportMenuOpen && (
              <div 
                className="absolute right-0 mt-1 w-44 rounded-lg bg-surface border border-border shadow-xl py-1 z-50 text-xs font-mono"
                onMouseLeave={() => setIsExportMenuOpen(false)}
              >
                <button
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    onExportJson();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-2 text-text flex items-center justify-between"
                >
                  <span>Export JSON</span>
                  <span className="text-[10px] text-text-muted">.json</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: Metric Counters & Stale Toggle */}
      <div className="px-6 py-2 border-t border-border/60 bg-bg/40 flex flex-wrap items-center justify-between gap-4 text-xs">
        {/* Coverage Counters */}
        <div className="flex items-center gap-5 overflow-x-auto font-mono text-[11px]">
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Apps:</span>
            <span className="text-text font-semibold">{coverage.applications}</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Services:</span>
            <span className="text-text font-semibold">{coverage.services}</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Routes:</span>
            <span className="text-text font-semibold">{coverage.routes}</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Inputs:</span>
            <span className="text-text font-semibold">{coverage.inputs}</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Identities:</span>
            <span className="text-text font-semibold">{coverage.identities}</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <span>Tech:</span>
            <span className="text-text font-semibold">{coverage.technologies ?? 2}</span>
          </div>
        </div>

        {/* Stale Assets Filter Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggleStaleFilter}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
              isStaleFilterActive
                ? 'bg-warning/20 text-warning border border-warning/50 font-semibold'
                : staleCount > 0
                ? 'bg-surface-2 text-warning hover:bg-warning/10 border border-border'
                : 'text-text-muted hover:text-text'
            }`}
            title="Filter to stale assets (last seen > 30 days ago)"
          >
            <AlertTriangle className={`w-3 h-3 ${staleCount > 0 ? 'text-warning' : 'text-text-muted'}`} />
            <span>{staleCount} Stale {staleCount === 1 ? 'Asset' : 'Assets'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
