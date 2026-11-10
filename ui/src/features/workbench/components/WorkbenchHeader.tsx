import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Shield, ShieldCheck, ShieldAlert, Download, 
  Upload, Terminal, RotateCw, History, Layers, GitCompare 
} from 'lucide-react';
import { ProjectSummary, ProjectScopeResponse, CaStatusResponse } from '../../../api/types';

export type WorkbenchViewTab = 'history' | 'repeater' | 'compare';

interface WorkbenchHeaderProps {
  project?: ProjectSummary | null;
  scopeData?: ProjectScopeResponse | null;
  caStatus?: CaStatusResponse | null;
  activeTab: WorkbenchViewTab;
  onChangeTab: (tab: WorkbenchViewTab) => void;
  historyCount: number;
  repeaterTabCount: number;
  onOpenCaHelper: () => void;
  onOpenImportModal: () => void;
  onExportHar: () => void;
  onExportJsonl: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const WorkbenchHeader: React.FC<WorkbenchHeaderProps> = ({
  project,
  scopeData,
  caStatus,
  activeTab,
  onChangeTab,
  historyCount,
  repeaterTabCount,
  onOpenCaHelper,
  onOpenImportModal,
  onExportHar,
  onExportJsonl,
  onRefresh,
  isRefreshing = false,
}) => {
  const navigate = useNavigate();
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  return (
    <header className="border-b border-border bg-surface shrink-0 select-none font-sans">
      {/* Top Row: Navigation, Title, Scope, CA, Actions */}
      <div className="h-14 px-6 flex items-center justify-between gap-4">
        {/* Left: Breadcrumbs & Title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(project ? `/projects/${project.id}` : '/')}
            className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
            title="Return to Project Overview"
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
            <span className="text-text-muted text-xs">/</span>
            <span 
              onClick={() => project && navigate(`/projects/${project.id}`)}
              className="text-text-muted text-xs truncate cursor-pointer hover:text-text"
            >
              {project?.name || 'Project'}
            </span>
            <span className="text-text-muted text-xs">/</span>
            <span className="font-semibold text-text text-sm truncate flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-accent" />
              <span>HTTP Workbench</span>
            </span>
          </div>

          {/* Scope Enforcement Pill */}
          <div 
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-mono shrink-0 bg-success/10 border-success/30 text-success"
            title={scopeData?.valid ? 'Scope strictly enforced' : 'Engagement policy active'}
          >
            <ShieldCheck className="w-3 h-3" />
            <span>Scope Enforced</span>
          </div>

          {/* CA Status Button */}
          <button
            onClick={onOpenCaHelper}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-mono shrink-0 transition-colors ${
              caStatus?.installed
                ? 'bg-surface-2 border-border text-text hover:border-accent'
                : 'bg-warning/15 border-warning/40 text-warning hover:bg-warning/25'
            }`}
            title="Configure Proxy CA certificate"
          >
            {caStatus?.installed ? (
              <Shield className="w-3 h-3 text-accent" />
            ) : (
              <ShieldAlert className="w-3 h-3 text-warning" />
            )}
            <span>CA: {caStatus?.installed ? 'Active' : 'Missing'}</span>
          </button>
        </div>

        {/* Right: Refresh, Import, Export */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors disabled:opacity-50"
            title="Refresh workbench history"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          {/* Import HAR Button */}
          <button
            onClick={onOpenImportModal}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
            title="Import HAR or Burp Suite capture"
          >
            <Upload className="w-3.5 h-3.5 text-text-muted" />
            <span>Import</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
              title="Export captured traffic"
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
                    onExportHar();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-2 text-text flex items-center justify-between"
                >
                  <span>Export HAR</span>
                  <span className="text-[10px] text-text-muted">.har</span>
                </button>
                <button
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    onExportJsonl();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-2 text-text flex items-center justify-between"
                >
                  <span>Export JSONL</span>
                  <span className="text-[10px] text-text-muted">.jsonl</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row: View Mode Switcher Tabs */}
      <div className="px-6 border-t border-border/60 bg-bg/40 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-1 py-1">
          <button
            onClick={() => onChangeTab('history')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-surface text-accent shadow-sm border border-border font-semibold'
                : 'text-text-muted hover:text-text hover:bg-surface/50'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Traffic History</span>
            <span className="px-1.5 py-0.2 rounded-full bg-surface-2 text-[10px] font-mono text-text-muted">
              {historyCount}
            </span>
          </button>

          <button
            onClick={() => onChangeTab('repeater')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'repeater'
                ? 'bg-surface text-accent shadow-sm border border-border font-semibold'
                : 'text-text-muted hover:text-text hover:bg-surface/50'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Repeater</span>
            <span className="px-1.5 py-0.2 rounded-full bg-surface-2 text-[10px] font-mono text-text-muted">
              {repeaterTabCount}
            </span>
          </button>

          <button
            onClick={() => onChangeTab('compare')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'compare'
                ? 'bg-surface text-accent shadow-sm border border-border font-semibold'
                : 'text-text-muted hover:text-text hover:bg-surface/50'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>Compare</span>
          </button>
        </div>
      </div>
    </header>
  );
};
