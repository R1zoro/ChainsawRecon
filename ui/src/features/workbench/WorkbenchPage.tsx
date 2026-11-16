import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Terminal, AlertCircle, X } from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { 
  ProjectSummary, 
  ProjectScopeResponse, 
  CaStatusResponse, 
  Paginated, 
  CapturedRequest, 
  RequestDetailResponse,
  ReplayResult 
} from '../../api/types';
import { parseQueryParams } from './redaction';
import { WorkbenchHeader, WorkbenchViewTab } from './components/WorkbenchHeader';
import { HistoryFilters } from './components/HistoryFilters';
import { WorkbenchHistoryTable } from './components/WorkbenchHistoryTable';
import { RequestResponseSplitViewer } from './components/RequestResponseSplitViewer';
import { RepeaterWorkspace, RepeaterTab } from './components/RepeaterWorkspace';
import { ResponseCompareView } from './components/ResponseCompareView';
import { CaHelperModal } from './components/CaHelperModal';
import { ImportHarModal } from './components/ImportHarModal';
import { SaveEvidenceModal } from './components/SaveEvidenceModal';

export const WorkbenchPage: React.FC = () => {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const projectId = routeProjectId || '';

  // 1. Navigation & View State
  const [activeTab, setActiveTab] = useState<WorkbenchViewTab>('history');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // 2. Filter & Pagination State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedAuth, setSelectedAuth] = useState('ALL');
  const [selectedTag, setSelectedTag] = useState('ALL');
  const [isInScopeOnly, setIsInScopeOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exportError, setExportError] = useState<string | null>(null);

  // 3. Modals State
  const [isCaModalOpen, setIsCaModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [evidenceRequest, setEvidenceRequest] = useState<CapturedRequest | null>(null);

  // 4. Repeater State
  const [repeaterTabs, setRepeaterTabs] = useState<RepeaterTab[]>([
    {
      id: 'tab_scratch_01',
      title: 'Scratch 1',
      editableRequest: {
        id: 'tab_scratch_01',
        baselineId: '',
        method: 'GET',
        url: 'https://api.example.com/api/v1/users/me',
        headers: [
          { key: 'Accept', value: 'application/json' },
          { key: 'Authorization', value: 'Bearer «redacted»' },
        ],
        queryParams: [],
        body: '',
      },
    },
  ]);
  const [activeRepeaterTabId, setActiveRepeaterTabId] = useState<string>('tab_scratch_01');

  // Query: Project Details
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchJson<ProjectSummary>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  // Query: Project Scope
  const { data: scopeData } = useQuery({
    queryKey: ['projectScope', projectId],
    queryFn: () => fetchJson<ProjectScopeResponse>(`/projects/${projectId}/scope`),
    enabled: Boolean(projectId),
  });

  // Query: Proxy CA Status
  const { data: caStatus } = useQuery({
    queryKey: ['caStatus'],
    queryFn: () => fetchJson<CaStatusResponse>('/workbench/ca'),
  });

  // Query: Captured Traffic History
  const { 
    data: historyData, 
    refetch: refetchHistory, 
    isFetching: isHistoryFetching 
  } = useQuery({
    queryKey: [
      'workbenchHistory', 
      projectId, 
      searchQuery, 
      selectedMethod, 
      selectedStatus, 
      selectedAuth, 
      selectedTag, 
      isInScopeOnly,
      currentPage,
      pageSize,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('projectId', projectId);
      if (searchQuery) params.set('q', searchQuery);
      if (selectedMethod !== 'ALL') params.set('method', selectedMethod);
      if (selectedStatus !== 'ALL') params.set('status', selectedStatus);
      if (selectedAuth !== 'ALL') params.set('auth', selectedAuth);
      if (selectedTag !== 'ALL') params.set('tag', selectedTag);
      if (isInScopeOnly) params.set('inScopeOnly', 'true');
      params.set('limit', String(pageSize));
      params.set('offset', String((currentPage - 1) * pageSize));
      return fetchJson<Paginated<CapturedRequest>>(`/workbench/history?${params.toString()}`);
    },
    enabled: Boolean(projectId),
  });

  const capturedRequests = historyData?.items || [];
  const totalCount = historyData?.total || 0;

  // Derive dynamic auth options from captured requests
  const authOptions = useMemo(() => {
    const set = new Set<string>();
    capturedRequests.forEach((r) => {
      if (r.authContext) set.add(r.authContext);
    });
    return Array.from(set).sort();
  }, [capturedRequests]);

  // Auto-select first request if none selected
  const activeSelectedId = selectedRequestId || (capturedRequests.length > 0 ? capturedRequests[0].id : null);
  const selectedRequest = capturedRequests.find((r) => r.id === activeSelectedId) || (capturedRequests.length > 0 ? capturedRequests[0] : null);

  // Query: Request Detail for Inspector
  const { data: requestDetail } = useQuery({
    queryKey: ['requestDetail', activeSelectedId],
    queryFn: () => fetchJson<RequestDetailResponse>(`/workbench/requests/${activeSelectedId}`),
    enabled: Boolean(activeSelectedId),
  });

  // Handlers
  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedMethod('ALL');
    setSelectedStatus('ALL');
    setSelectedAuth('ALL');
    setSelectedTag('ALL');
    setIsInScopeOnly(false);
    setCurrentPage(1);
  };

  const handleSendToRepeater = (req: CapturedRequest) => {
    const newTabId = `tab_${Date.now()}`;
    const headersList: Array<{ key: string; value: string }> = [];
    Object.entries(req.requestHeaders || {}).forEach(([key, value]) => {
      headersList.push({ key, value });
    });

    const queryList = parseQueryParams(req.url || req.path);

    const newTab: RepeaterTab = {
      id: newTabId,
      title: `${repeaterTabs.length + 1}: ${req.method} ${req.path}`,
      baselineRequest: req,
      editableRequest: {
        id: newTabId,
        baselineId: req.id,
        method: req.method,
        url: req.url || `https://${req.host}${req.path}`,
        headers: headersList,
        queryParams: queryList,
        body: req.requestBodyPreview || '',
      },
    };

    setRepeaterTabs((prev) => [...prev, newTab]);
    setActiveRepeaterTabId(newTabId);
    setActiveTab('repeater');
  };

  const handleAddScratchTab = () => {
    const newTabId = `tab_${Date.now()}`;
    const newTab: RepeaterTab = {
      id: newTabId,
      title: `Scratch ${repeaterTabs.length + 1}`,
      editableRequest: {
        id: newTabId,
        baselineId: '',
        method: 'GET',
        url: 'https://api.example.com/api/v1/resource',
        headers: [{ key: 'Accept', value: 'application/json' }],
        queryParams: [],
        body: '',
      },
    };
    setRepeaterTabs((prev) => [...prev, newTab]);
    setActiveRepeaterTabId(newTabId);
  };

  const handleCloseTab = (id: string) => {
    setRepeaterTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeRepeaterTabId === id && filtered.length > 0) {
        setActiveRepeaterTabId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleUpdateTabRequest = (tabId: string, updated: RepeaterTab['editableRequest']) => {
    setRepeaterTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, editableRequest: updated } : t))
    );
  };

  const handleTabReplayed = (tabId: string, result: ReplayResult) => {
    setRepeaterTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, replayResult: result } : t))
    );
    queryClient.invalidateQueries({ queryKey: ['workbenchHistory'] });
  };

  const handleExportHar = async () => {
    setExportError(null);
    try {
      const data = await fetchJson<{ data: unknown }>(`/workbench/export?projectId=${projectId}&format=har`);
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name || 'chainsaw'}_traffic.har`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(isApiError(err) ? err.message : 'HAR export failed. Verify workbench data availability.');
    }
  };

  const handleExportJsonl = async () => {
    setExportError(null);
    try {
      const data = await fetchJson<{ data: unknown[] }>(`/workbench/export?projectId=${projectId}&format=jsonl`);
      const lines = (data.data || []).map((item) => JSON.stringify(item)).join('\n');
      const blob = new Blob([lines + (lines ? '\n' : '')], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name || 'chainsaw'}_traffic.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(isApiError(err) ? err.message : 'JSONL export failed. Verify workbench data availability.');
    }
  };

  return (
    <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none selection:bg-accent/20 selection:text-accent">
      {/* 1. Top Workbench Header */}
      <WorkbenchHeader
        project={project}
        scopeData={scopeData}
        caStatus={caStatus}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        historyCount={capturedRequests.length}
        repeaterTabCount={repeaterTabs.length}
        onOpenCaHelper={() => setIsCaModalOpen(true)}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onExportHar={handleExportHar}
        onExportJsonl={handleExportJsonl}
        onRefresh={() => refetchHistory()}
        isRefreshing={isHistoryFetching}
      />

      {/* Export Error Banner */}
      {exportError && (
        <div className="bg-danger/15 border-b border-danger/30 px-4 py-2.5 flex items-center justify-between text-danger font-mono text-xs shrink-0">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span><strong>Export Error:</strong> {exportError}</span>
          </div>
          <button
            onClick={() => setExportError(null)}
            className="p-1 rounded hover:bg-danger/20 text-danger"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. Main Work Surface */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {activeTab === 'history' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Multi-axis Filter Bar */}
            <HistoryFilters
              searchQuery={searchQuery}
              onSearchChange={(q) => {
                setSearchQuery(q);
                setCurrentPage(1);
              }}
              selectedMethod={selectedMethod}
              onSelectMethod={(m) => {
                setSelectedMethod(m);
                setCurrentPage(1);
              }}
              selectedStatus={selectedStatus}
              onSelectStatus={(s) => {
                setSelectedStatus(s);
                setCurrentPage(1);
              }}
              selectedAuth={selectedAuth}
              onSelectAuth={(a) => {
                setSelectedAuth(a);
                setCurrentPage(1);
              }}
              selectedTag={selectedTag}
              onSelectTag={(t) => {
                setSelectedTag(t);
                setCurrentPage(1);
              }}
              isInScopeOnly={isInScopeOnly}
              onToggleInScopeOnly={() => {
                setIsInScopeOnly(!isInScopeOnly);
                setCurrentPage(1);
              }}
              onResetFilters={handleResetFilters}
              totalCount={totalCount}
              filteredCount={capturedRequests.length}
              authOptions={authOptions}
            />

            {/* Split: History Table (Left) + Split Request/Response Viewer (Right) */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="w-1/2 flex flex-col min-h-0">
                <WorkbenchHistoryTable
                  requests={capturedRequests}
                  selectedRequest={selectedRequest}
                  onSelectRequest={(req) => setSelectedRequestId(req.id)}
                  onSendToRepeater={handleSendToRepeater}
                  currentPage={currentPage}
                  pageSize={pageSize}
                  totalCount={totalCount}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={(ps) => {
                    setPageSize(ps);
                    setCurrentPage(1);
                  }}
                />
              </div>

              {selectedRequest ? (
                <RequestResponseSplitViewer
                  request={selectedRequest}
                  detail={requestDetail}
                  onSendToRepeater={handleSendToRepeater}
                  onSaveEvidence={(req) => setEvidenceRequest(req)}
                  onCompareWithBaseline={() => setActiveTab('compare')}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-surface border-l border-border text-text-muted space-y-2">
                  <Terminal className="w-8 h-8 opacity-40" />
                  <p className="text-xs">Select any captured HTTP request from the table to inspect details.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'repeater' && (
          <RepeaterWorkspace
            tabs={repeaterTabs}
            projectId={projectId}
            activeTabId={activeRepeaterTabId}
            onSelectTab={setActiveRepeaterTabId}
            onAddTab={handleAddScratchTab}
            onCloseTab={handleCloseTab}
            onUpdateTabRequest={handleUpdateTabRequest}
            onSaveEvidence={(req) => setEvidenceRequest(req)}
            onTabReplayed={handleTabReplayed}
          />
        )}

        {activeTab === 'compare' && (
          <ResponseCompareView
            requests={capturedRequests}
            initialBaselineId={selectedRequest?.id}
          />
        )}
      </div>

      {/* 3. Modals */}
      <CaHelperModal
        isOpen={isCaModalOpen}
        onClose={() => setIsCaModalOpen(false)}
        caStatus={caStatus}
      />

      <ImportHarModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        projectId={projectId}
        onImportComplete={() => refetchHistory()}
      />

      <SaveEvidenceModal
        isOpen={Boolean(evidenceRequest)}
        onClose={() => setEvidenceRequest(null)}
        request={evidenceRequest}
        projectId={projectId}
        onSaved={(_evId) => {
          queryClient.invalidateQueries({ queryKey: ['evidence'] });
        }}
      />
    </div>
  );
};
