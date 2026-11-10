import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, RotateCw, Copy, Check, Plus, FolderKanban } from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { 
  ProjectSummary, 
  ProjectScopeResponse, 
  AppGraphResponse, 
  Paginated, 
  AppEntity, 
  EntityDetailResponse, 
  NoteItem 
} from '../../api/types';
import { ProjectHeader, AppModelViewTab } from './components/ProjectHeader';
import { AppModelGraphView } from './components/AppModelGraphView';
import { AppModelTableView } from './components/AppModelTableView';
import { EntityDetailDrawer } from './components/EntityDetailDrawer';

export const ProjectOverviewPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Tab & Selection State
  const [activeTab, setActiveTab] = useState<AppModelViewTab>('graph');
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [rootId, setRootId] = useState<string | undefined>(undefined);

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKind, setSelectedKind] = useState('all');
  const [selectedConfidence, setSelectedConfidence] = useState('all');
  const [isStaleOnly, setIsStaleOnly] = useState(false);
  const [isAuthBoundaryOnly, setIsAuthBoundaryOnly] = useState(false);
  const [maxNodes, setMaxNodes] = useState(300);

  const [copiedRequestId, setCopiedRequestId] = useState(false);

  // 1. Fetch Project Details
  const { 
    data: project, 
    isLoading: isProjectLoading, 
    error: projectError, 
    refetch: refetchProject, 
    isFetching: isProjectFetching 
  } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchJson<ProjectSummary>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
    retry: false,
  });

  // 2. Fetch Project Scope
  const { data: scopeData } = useQuery({
    queryKey: ['projectScope', projectId],
    queryFn: () => fetchJson<ProjectScopeResponse>(`/projects/${projectId}/scope`),
    enabled: Boolean(projectId),
  });

  // 3. Fetch App Model Graph
  const { 
    data: graphData, 
    refetch: refetchGraph, 
    isFetching: isGraphFetching 
  } = useQuery({
    queryKey: ['appModelGraph', projectId, rootId, maxNodes],
    queryFn: () => {
      const rootParam = rootId ? `&rootId=${encodeURIComponent(rootId)}` : '';
      return fetchJson<AppGraphResponse>(`/projects/${projectId}/app-model/graph?maxNodes=${maxNodes}${rootParam}`);
    },
    enabled: Boolean(projectId),
  });

  // 4. Fetch App Model Entities List (For Table View & Edge traversal)
  const { 
    data: entitiesData, 
    refetch: refetchEntities, 
    isFetching: isEntitiesFetching 
  } = useQuery({
    queryKey: ['appModelEntities', projectId, isStaleOnly],
    queryFn: () => {
      const staleParam = isStaleOnly ? '&stale=true' : '';
      return fetchJson<Paginated<AppEntity> & { stale: boolean }>(
        `/projects/${projectId}/app-model?limit=500${staleParam}`
      );
    },
    enabled: Boolean(projectId),
  });

  // 5. Fetch Entity Detail & Notes when selected
  const { data: entityDetailData } = useQuery({
    queryKey: ['entityDetail', projectId, selectedEntityId],
    queryFn: () => fetchJson<EntityDetailResponse>(`/projects/${projectId}/app-model/entities/${selectedEntityId}`),
    enabled: Boolean(projectId && selectedEntityId),
  });

  // Entities & Edges collections
  const entities = useMemo(() => {
    return entitiesData?.items?.length ? entitiesData.items : (graphData?.entities ?? []);
  }, [entitiesData, graphData]);

  const edges = useMemo(() => {
    return graphData?.edges || [];
  }, [graphData]);

  // Selected Entity object
  const selectedEntity = useMemo(() => {
    if (!selectedEntityId) return null;
    return entities.find((e) => e.id === selectedEntityId) || entityDetailData?.entity || null;
  }, [selectedEntityId, entities, entityDetailData]);

  const staleCount = useMemo(() => {
    return entities.filter((e) => e.stale).length;
  }, [entities]);

  // Handlers
  const handleRefresh = async () => {
    await Promise.all([
      refetchProject(),
      refetchGraph(),
      refetchEntities(),
    ]);
  };

  const handleExportJson = async () => {
    if (!projectId) return;
    try {
      const exportData = await fetchJson<{ summary: unknown; graph: unknown }>(
        `/projects/${projectId}/app-model/export`
      );
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name || 'app-model'}_export.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[ProjectOverview] Export JSON failed', err);
    }
  };

  const handleAddNote = async (entityId: string, content: string) => {
    if (!projectId) return;
    await fetchJson<NoteItem>(`/projects/${projectId}/app-model/entities/${entityId}/note`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    await queryClient.invalidateQueries({ queryKey: ['entityDetail', projectId, entityId] });
  };

  const handleFocusNeighbors = (entityId: string) => {
    setRootId(entityId);
    setSelectedEntityId(entityId);
  };

  const handleClearRoot = () => {
    setRootId(undefined);
  };

  // Structured Skeleton Loading
  if (isProjectLoading) {
    return (
      <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none animate-pulse">
        <header className="border-b border-border bg-surface h-14 px-6 flex items-center justify-between">
          <div className="h-4 w-48 bg-surface-2 rounded" />
          <div className="h-8 w-64 bg-surface-2 rounded-md" />
        </header>
        <div className="h-10 border-b border-border bg-bg/50 px-6 flex items-center gap-6">
          <div className="h-3 w-20 bg-surface-2 rounded" />
          <div className="h-3 w-20 bg-surface-2 rounded" />
          <div className="h-3 w-20 bg-surface-2 rounded" />
        </div>
        <div className="flex-1 bg-[#0A0D12] flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-text-muted">
            <RotateCw className="w-6 h-6 animate-spin text-accent" />
            <p className="text-xs font-mono">Loading application topology...</p>
          </div>
        </div>
      </div>
    );
  }

  // Structured Error Region
  if (projectError) {
    const isTyped = isApiError(projectError);
    const code = isTyped ? projectError.code : 'UNKNOWN_ERROR';
    const message = isTyped ? projectError.message : String(projectError);
    const requestId = isTyped ? projectError.request_id : 'n/a';

    const handleCopyRequestId = () => {
      navigator.clipboard.writeText(requestId);
      setCopiedRequestId(true);
      setTimeout(() => setCopiedRequestId(false), 2000);
    };

    return (
      <div className="h-screen bg-bg text-text flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="max-w-md w-full bg-surface border border-danger/40 rounded-xl p-6 shadow-2xl space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-danger/10 text-danger border border-danger/30">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">Failed to Load Project</h2>
              <span className="text-[10px] font-mono text-danger font-medium uppercase">{code}</span>
            </div>
          </div>

          <p className="text-xs text-text-muted leading-relaxed font-sans">{message}</p>

          <div className="p-2.5 rounded bg-bg border border-border flex items-center justify-between text-[11px] font-mono text-text-muted">
            <span>Request ID:</span>
            <div 
              onClick={handleCopyRequestId}
              className="flex items-center gap-1.5 cursor-pointer hover:text-text transition-colors"
              title="Copy Request ID"
            >
              <span>{requestId}</span>
              {copiedRequestId ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 opacity-60" />}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => navigate('/')}
              className="px-3 py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 text-xs transition-colors"
            >
              Back to Engagements
            </button>
            <button
              onClick={() => refetchProject()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Honest Empty State: Project exists, but no application model entities seeded or mapped yet
  const hasNoEntities = entities.length === 0 && (!graphData || graphData.entities.length === 0);

  return (
    <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none selection:bg-accent/20 selection:text-accent">
      {/* 1. Project Shell Header */}
      <ProjectHeader
        project={project}
        scopeData={scopeData}
        activeSession={project?.activeSession}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        staleCount={staleCount}
        isStaleFilterActive={isStaleOnly}
        onToggleStaleFilter={() => setIsStaleOnly(!isStaleOnly)}
        onRefresh={handleRefresh}
        onExportJson={handleExportJson}
        isRefreshing={isProjectFetching || isGraphFetching || isEntitiesFetching}
      />

      {/* Root Focus Clear Banner (when double-click focused on a sub-neighborhood) */}
      {rootId && (
        <div className="bg-accent/10 border-b border-accent/30 px-6 py-1.5 flex items-center justify-between text-xs font-mono text-accent shrink-0">
          <span>Focused neighborhood: {rootId}</span>
          <button
            onClick={handleClearRoot}
            className="text-[11px] hover:underline font-semibold"
          >
            Reset Root to Application &times;
          </button>
        </div>
      )}

      {/* 2. Main Work Surface (Graph vs Table + Slide-over Detail Drawer) */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {hasNoEntities ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3 bg-[#0A0D12]">
            <div className="p-3 rounded-full bg-surface border border-border text-text-muted">
              <FolderKanban className="w-8 h-8 opacity-60 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text">No application model yet</h2>
            <p className="text-xs text-text-muted max-w-md leading-relaxed font-sans">
              No services, routes, or assets have been discovered for this engagement. Start an automated scan session or import a HAR/source tree to build the topology graph.
            </p>
            <div className="pt-2">
              <button
                onClick={() => navigate('/engagements/new')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-lg shadow-accent/10"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Start New Session</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'graph' ? (
              <AppModelGraphView
                entities={entities}
                edges={edges}
                truncated={Boolean(graphData?.truncated)}
                totalEntities={graphData?.totalEntities || entities.length}
                selectedEntity={selectedEntity}
                onSelectEntity={(entity) => setSelectedEntityId(entity.id)}
                onFocusNeighbors={handleFocusNeighbors}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedKind={selectedKind}
                onSelectKind={setSelectedKind}
                selectedConfidence={selectedConfidence}
                onSelectConfidence={setSelectedConfidence}
                isStaleOnly={isStaleOnly}
                onToggleStaleOnly={() => setIsStaleOnly(!isStaleOnly)}
                isAuthBoundaryOnly={isAuthBoundaryOnly}
                onToggleAuthBoundaryOnly={() => setIsAuthBoundaryOnly(!isAuthBoundaryOnly)}
                maxNodes={maxNodes}
                onChangeMaxNodes={setMaxNodes}
              />
            ) : (
              <AppModelTableView
                entities={entities}
                selectedEntity={selectedEntity}
                onSelectEntity={(entity) => setSelectedEntityId(entity.id)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                selectedKind={selectedKind}
                onSelectKind={setSelectedKind}
                isStaleOnly={isStaleOnly}
                onToggleStaleOnly={() => setIsStaleOnly(!isStaleOnly)}
              />
            )}

            {/* Slide-over Entity Detail Drawer */}
            {selectedEntity && (
              <EntityDetailDrawer
                entity={selectedEntity}
                edges={edges}
                notes={entityDetailData?.notes || []}
                allEntities={entities}
                onClose={() => setSelectedEntityId(null)}
                onSelectEntity={(entity) => setSelectedEntityId(entity.id)}
                onFilterGraphToNeighbors={handleFocusNeighbors}
                onAddNote={handleAddNote}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};
