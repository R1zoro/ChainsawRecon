import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { fetchJson } from '../../api/client';
import { 
  ProjectSummary, 
  ProjectScopeResponse, 
  Finding, 
  FindingDetailResponse, 
  Paginated 
} from '../../api/types';
import { FindingsHeader } from './components/FindingsHeader';
import { FindingsList } from './components/FindingsList';
import { FindingDetailView } from './components/FindingDetailView';
import { TransitionFindingModal } from './components/TransitionFindingModal';

export const FindingsPage: React.FC = () => {
  const { projectId: routeProjectId, findingId: routeFindingId } = useParams<{ 
    projectId: string; 
    findingId: string; 
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectId = routeProjectId || '';

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState('ALL');
  const [selectedSeverity, setSelectedSeverity] = useState('ALL');

  // Transition Modal State
  const [isTransitionModalOpen, setIsTransitionModalOpen] = useState(false);

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

  // Query: Findings List
  const { 
    data: findingsData, 
    refetch: refetchFindings, 
    isFetching: isFindingsFetching 
  } = useQuery({
    queryKey: ['findings', projectId, searchQuery, selectedState, selectedSeverity],
    queryFn: () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);
      if (searchQuery) params.set('q', searchQuery);
      if (selectedState !== 'ALL') params.set('state', selectedState);
      if (selectedSeverity !== 'ALL') params.set('severity', selectedSeverity);
      return fetchJson<Paginated<Finding>>(`/findings?${params.toString()}`);
    },
    enabled: Boolean(projectId),
  });

  const findings = findingsData?.items || [];

  // Determine Active Finding ID
  const activeFindingId = routeFindingId || (findings.length > 0 ? findings[0].id : null);

  // Query: Active Finding Detail (with evidence)
  const { data: findingDetailData } = useQuery({
    queryKey: ['findingDetail', activeFindingId],
    queryFn: () => fetchJson<FindingDetailResponse>(`/findings/${activeFindingId}`),
    enabled: Boolean(activeFindingId),
  });

  // Fallback to finding from list if detail hasn't loaded yet
  const activeFinding = findingDetailData?.finding || findings.find((f) => f.id === activeFindingId) || null;
  const activeEvidence = findingDetailData?.evidence || [];

  // Counters
  const candidateCount = findings.filter((f) => f.state === 'candidate' || f.state === 'reproduced' || f.state === 'observed').length;
  const validatedCount = findings.filter((f) => f.state === 'validated').length;
  const rejectedCount = findings.filter((f) => f.state === 'rejected').length;

  const handleSelectFinding = (finding: Finding) => {
    navigate(`/projects/${projectId}/findings/${finding.id}`);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedState('ALL');
    setSelectedSeverity('ALL');
  };

  const handleTransitionSuccess = (updated: Finding) => {
    queryClient.invalidateQueries({ queryKey: ['findings'] });
    queryClient.invalidateQueries({ queryKey: ['findingDetail', updated.id] });
  };

  return (
    <div className="h-screen bg-bg text-text flex flex-col font-sans overflow-hidden select-none selection:bg-accent/20 selection:text-accent">
      {/* 1. Header */}
      <FindingsHeader
        project={project}
        scopeData={scopeData}
        projectId={projectId}
        totalFindings={findings.length}
        candidateCount={candidateCount}
        validatedCount={validatedCount}
        rejectedCount={rejectedCount}
        onRefresh={() => refetchFindings()}
        isRefreshing={isFindingsFetching}
      />

      {/* 2. Main Surface: Left List + Center Detail */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <FindingsList
          findings={findings}
          selectedFindingId={activeFindingId}
          onSelectFinding={handleSelectFinding}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedState={selectedState}
          onSelectState={setSelectedState}
          selectedSeverity={selectedSeverity}
          onSelectSeverity={setSelectedSeverity}
          onResetFilters={handleResetFilters}
          projectId={projectId}
        />

        {activeFinding ? (
          <FindingDetailView
            finding={activeFinding}
            evidence={activeEvidence}
            evidenceBindings={findingDetailData?.evidenceBindings}
            projectId={projectId}
            onOpenTransitionModal={() => setIsTransitionModalOpen(true)}
            onEvidenceChange={() => {
              queryClient.invalidateQueries({ queryKey: ['findings'] });
              queryClient.invalidateQueries({ queryKey: ['findingDetail', activeFindingId] });
            }}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-surface select-none space-y-3">
            <Inbox className="w-10 h-10 opacity-30 text-text-muted" />
            <h3 className="text-sm font-semibold text-text">No finding selected</h3>
            <p className="text-xs text-text-muted max-w-sm">
              Select a finding from the left panel to inspect reproduction steps, wire evidence, and gate verification status.
            </p>
          </div>
        )}
      </div>

      {/* 3. Transition Governance Modal */}
      <TransitionFindingModal
        isOpen={isTransitionModalOpen}
        onClose={() => setIsTransitionModalOpen(false)}
        finding={activeFinding}
        onTransitionSuccess={handleTransitionSuccess}
      />
    </div>
  );
};
