import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FolderPlus, FolderOpen, Download, LayoutGrid, List, 
  MoreVertical, ShieldCheck, AlertTriangle, AlertCircle, 
  Trash2, Archive, Calendar
} from 'lucide-react';
import { ProjectSummary, ScopeStatus } from '../../api/types';
import { formatRelativeTime } from '../../lib/utils';
import { RemoveProjectModal } from '../../components/modals/RemoveProjectModal';

interface EngagementsSectionProps {
  projects: ProjectSummary[];
  searchQuery: string;
  onOpenFolderModal: () => void;
  onOpenImportModal: () => void;
  onArchiveProject: (id: string) => void;
  onRemoveProject: (id: string) => void;
}

type SortField = 'lastActivity' | 'name' | 'findings';
type FilterStatus = 'all' | 'running' | 'needs_review' | 'completed';

export const EngagementsSection: React.FC<EngagementsSectionProps> = ({
  projects,
  searchQuery,
  onOpenFolderModal,
  onOpenImportModal,
  onArchiveProject,
  onRemoveProject,
}) => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [sortField, setSortField] = useState<SortField>('lastActivity');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<ProjectSummary | null>(null);

  // Filter logic
  const filtered = projects.filter((p) => {
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameMatch = p.name.toLowerCase().includes(q);
      const pathMatch = p.path.toLowerCase().includes(q);
      const targetMatch = p.targets?.some((t) => t.toLowerCase().includes(q));
      if (!nameMatch && !pathMatch && !targetMatch) return false;
    }

    // Status filter
    if (filter === 'running') return p.activeSession?.status === 'running';
    if (filter === 'needs_review') return p.scopeStatus === 'invalid' || p.openFindings > 0;
    if (filter === 'completed') return !p.activeSession || p.activeSession.status === 'completed';
    return true;
  });

  // Sort logic
  const sorted = [...filtered].sort((a, b) => {
    if (sortField === 'name') return a.name.localeCompare(b.name);
    if (sortField === 'findings') return b.openFindings - a.openFindings;
    return new Date(b.lastOpenedAt).getTime() - new Date(a.lastOpenedAt).getTime();
  });

  const getScopeBadge = (status: ScopeStatus) => {
    switch (status) {
      case 'ok':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-success bg-success/10 px-1.5 py-0.5 rounded border border-success/30">
            <ShieldCheck className="w-3 h-3" />
            OK
          </span>
        );
      case 'empty':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-warning bg-warning/10 px-1.5 py-0.5 rounded border border-warning/30">
            <AlertTriangle className="w-3 h-3" />
            EMPTY
          </span>
        );
      case 'invalid':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-danger bg-danger/10 px-1.5 py-0.5 rounded border border-danger/30">
            <AlertCircle className="w-3 h-3" />
            INVALID
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Title & Filter Chips */}
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold text-text text-base tracking-tight">Engagements</h2>
          <div className="flex items-center gap-1 bg-surface border border-border p-0.5 rounded text-xs">
            {(['all', 'running', 'needs_review', 'completed'] as FilterStatus[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded text-xs font-mono capitalize transition-colors ${
                  filter === f
                    ? 'bg-surface-2 text-text font-medium border border-border'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons & View Toggle */}
        <div className="flex items-center gap-2">
          {/* Sort selector */}
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value as SortField)}
            className="bg-surface text-xs text-text border border-border rounded px-2.5 py-1.5 focus:outline-none focus:border-accent font-mono"
          >
            <option value="lastActivity">Sort: Last activity</option>
            <option value="name">Sort: Name</option>
            <option value="findings">Sort: Open findings</option>
          </select>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-surface border border-border rounded p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              title="Grid View"
              aria-label="Grid view"
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'grid' ? 'bg-surface-2 text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              title="Table View"
              aria-label="Table view"
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'table' ? 'bg-surface-2 text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => navigate('/engagements/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent text-[#0D1015] hover:bg-accent-hover transition-colors font-sans"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>

          <button
            onClick={onOpenFolderModal}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border transition-colors font-sans"
          >
            <FolderOpen className="w-3.5 h-3.5 text-text-muted" />
            <span>Open folder</span>
          </button>

          <button
            onClick={onOpenImportModal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded bg-surface-2 text-text-muted hover:text-text border border-border transition-colors font-sans"
            title="Import Scope or HAR"
            aria-label="Import Scope or HAR"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Grid or Table or Empty View */}
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center space-y-3">
          <p className="text-text font-medium text-sm">No engagements match your filter criteria.</p>
          <p className="text-text-muted text-xs">Create a new engagement or reset the search query to continue.</p>
          <button
            onClick={() => navigate('/engagements/new')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent text-[#0D1015] hover:bg-accent-hover transition-colors mt-2"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New engagement</span>
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/projects/${project.id}`)}
              className="group relative rounded-lg border border-border bg-surface hover:border-accent/60 p-4 transition-all cursor-pointer flex flex-col justify-between hover:bg-surface/90"
            >
              {/* Card Header */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <h3 className="font-semibold text-text text-sm group-hover:text-accent transition-colors leading-tight">
                      {project.name}
                    </h3>
                    <p className="text-[11px] font-mono text-text-muted truncate max-w-[220px]" title={project.path}>
                      {project.path}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {getScopeBadge(project.scopeStatus)}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(activeMenuId === project.id ? null : project.id);
                      }}
                      aria-label="More actions"
                      className="p-1 text-text-muted hover:text-text rounded hover:bg-surface-2 transition-colors"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Targets Preview */}
                <div className="flex items-center gap-1 flex-wrap pt-1 font-mono text-[10px] text-text-muted">
                  <span>Targets:</span>
                  <span className="text-text">{project.targets.slice(0, 2).join(', ')}</span>
                  {project.targets.length > 2 && (
                    <span className="text-text-muted/70">+{project.targets.length - 2} more</span>
                  )}
                </div>
              </div>

              {/* Card Metrics & Footer */}
              <div className="pt-4 border-t border-border/60 mt-4 space-y-2 text-xs">
                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div className="bg-bg/60 p-1.5 rounded border border-border/40">
                    <span className="text-[10px] text-text-muted block">Sessions</span>
                    <span className="text-text font-semibold">{project.sessionCount}</span>
                  </div>
                  <div className="bg-bg/60 p-1.5 rounded border border-border/40">
                    <span className="text-[10px] text-text-muted block">Findings</span>
                    <span className={`font-semibold ${project.openFindings > 0 ? 'text-danger' : 'text-text'}`}>
                      {project.openFindings}
                    </span>
                  </div>
                  <div className="bg-bg/60 p-1.5 rounded border border-border/40">
                    <span className="text-[10px] text-text-muted block">Targets</span>
                    <span className="text-text font-semibold">{project.targets.length}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-text-muted pt-1">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-text-muted/60" />
                    {formatRelativeTime(project.lastOpenedAt)}
                  </span>

                  {project.activeSession?.status === 'running' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-success">
                      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                      Active session
                    </span>
                  )}
                </div>
              </div>

              {/* Dropdown Menu */}
              {activeMenuId === project.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-3 top-10 w-44 rounded-md border border-border bg-surface-2 shadow-xl py-1 z-30 font-sans text-xs"
                >
                  <button
                    onClick={() => {
                      setActiveMenuId(null);
                      navigate(`/projects/${project.id}`);
                    }}
                    className="w-full text-left px-3 py-1.5 text-text hover:bg-surface flex items-center gap-2"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-text-muted" />
                    Open Overview
                  </button>
                  <button
                    onClick={() => {
                      setActiveMenuId(null);
                      onArchiveProject(project.id);
                    }}
                    className="w-full text-left px-3 py-1.5 text-text hover:bg-surface flex items-center gap-2"
                  >
                    <Archive className="w-3.5 h-3.5 text-text-muted" />
                    Archive
                  </button>
                  <div className="h-px bg-border my-1"></div>
                  <button
                    onClick={() => {
                      setActiveMenuId(null);
                      setProjectToRemove(project);
                    }}
                    className="w-full text-left px-3 py-1.5 text-danger hover:bg-danger/10 flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove from index
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Compact Table View */
        <div className="rounded-lg border border-border bg-surface overflow-hidden">
          <table className="w-full text-left text-xs font-sans border-collapse">
            <thead>
              <tr className="border-b border-border bg-bg/80 text-[11px] font-mono text-text-muted uppercase tracking-wider">
                <th className="py-2.5 px-4 font-medium">Name</th>
                <th className="py-2.5 px-4 font-medium">Path</th>
                <th className="py-2.5 px-4 font-medium text-center">Status</th>
                <th className="py-2.5 px-4 font-medium text-center">Sessions</th>
                <th className="py-2.5 px-4 font-medium text-center">Findings</th>
                <th className="py-2.5 px-4 font-medium">Last Activity</th>
                <th className="py-2.5 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {sorted.map((project) => (
                <tr
                  key={project.id}
                  onClick={() => navigate(`/projects/${project.id}`)}
                  className="hover:bg-surface-2/60 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4 font-medium text-text">
                    {project.name}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-text-muted text-[11px]">
                    {project.path}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {getScopeBadge(project.scopeStatus)}
                  </td>
                  <td className="py-2.5 px-4 text-center font-mono text-text">
                    {project.sessionCount}
                  </td>
                  <td className="py-2.5 px-4 text-center font-mono">
                    <span className={project.openFindings > 0 ? 'text-danger font-semibold' : 'text-text-muted'}>
                      {project.openFindings}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-text-muted font-mono text-[11px]">
                    {formatRelativeTime(project.lastOpenedAt)}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/projects/${project.id}`);
                      }}
                      className="text-accent hover:underline font-mono text-[11px]"
                    >
                      Open &rarr;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Remove Confirmation Modal */}
      {projectToRemove && (
        <RemoveProjectModal
          isOpen={true}
          onClose={() => setProjectToRemove(null)}
          projectName={projectToRemove.name}
          onConfirm={() => onRemoveProject(projectToRemove.id)}
        />
      )}
    </div>
  );
};
