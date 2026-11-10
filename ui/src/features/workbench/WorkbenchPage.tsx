import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Terminal } from 'lucide-react';
import { fetchJson } from '../../api/client';
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

  const projectId = routeProjectId || 'prj_demo';

  // 1. Navigation & View State
  const [activeTab, setActiveTab] = useState<WorkbenchViewTab>('history');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // 2. Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedAuth, setSelectedAuth] = useState('ALL');
  const [selectedTag, setSelectedTag] = useState('ALL');
  const [isInScopeOnly, setIsInScopeOnly] = useState(false);

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
      isInScopeOnly
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
      return fetchJson<Paginated<CapturedRequest>>(`/workbench/history?${params.toString()}`);
    },
  });

  const capturedRequests = historyData?.items || [];
  const totalCount = historyData?.total || 0;

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
    } catch {
      // Export handled
    }
  };

  const handleExportJsonl = async () => {
    try {
      const data = await fetchJson<{ data: unknown }>(`/workbench/export?projectId=${projectId}&format=jsonl`);
      const blob = new Blob([JSON.stringify(data.data)], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.name || 'chainsaw'}_traffic.jsonl`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Export handled
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

      {/* 2. Main Work Surface */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {activeTab === 'history' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Multi-axis Filter Bar */}
            <HistoryFilters
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedMethod={selectedMethod}
              onSelectMethod={setSelectedMethod}
              selectedStatus={selectedStatus}
              onSelectStatus={setSelectedStatus}
              selectedAuth={selectedAuth}
              onSelectAuth={setSelectedAuth}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              isInScopeOnly={isInScopeOnly}
              onToggleInScopeOnly={() => setIsInScopeOnly(!isInScopeOnly)}
              onResetFilters={handleResetFilters}
              totalCount={totalCount}
              filteredCount={capturedRequests.length}
            />

            {/* Split: History Table (Left) + Split Request/Response Viewer (Right) */}
            <div className="flex-1 flex min-h-0 overflow-hidden">
              <div className="w-1/2 flex flex-col min-h-0">
                <WorkbenchHistoryTable
                  requests={capturedRequests}
                  selectedRequest={selectedRequest}
                  onSelectRequest={(req) => setSelectedRequestId(req.id)}
                  onSendToRepeater={handleSendToRepeater}
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
        onImportComplete={() => refetchHistory()}
      />

      <SaveEvidenceModal
        isOpen={Boolean(evidenceRequest)}
        onClose={() => setEvidenceRequest(null)}
        request={evidenceRequest}
        onSaved={(_evId) => {
          queryClient.invalidateQueries({ queryKey: ['evidence'] });
        }}
      />
    </div>
  );
};
