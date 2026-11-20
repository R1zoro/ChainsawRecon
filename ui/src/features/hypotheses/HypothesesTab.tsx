import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  HelpCircle, Plus, RotateCw, AlertCircle, Search, Filter 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { Hypothesis, Paginated } from '../../api/types';
import { HypothesisCard } from './components/HypothesisCard';
import { CreateHypothesisModal } from './components/CreateHypothesisModal';
import { TransitionHypothesisModal } from './components/TransitionHypothesisModal';

interface HypothesesTabProps {
  sessionId: string;
  projectId: string;
}

export const HypothesesTab: React.FC<HypothesesTabProps> = ({
  sessionId,
  projectId,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState<string>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState<Hypothesis | null>(null);

  const {
    data: hypothesesData,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['hypotheses', sessionId],
    queryFn: () => fetchJson<Paginated<Hypothesis>>(`/sessions/${sessionId}/hypotheses`),
    enabled: Boolean(sessionId),
  });

  const hypotheses = hypothesesData?.items || [];

  const filteredHypotheses = hypotheses.filter((h) => {
    if (selectedState !== 'all' && h.state !== selectedState) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        h.title.toLowerCase().includes(q) ||
        h.securityQuestion.toLowerCase().includes(q) ||
        h.surface.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const stateCounts = {
    all: hypotheses.length,
    suspected: hypotheses.filter((h) => h.state === 'suspected').length,
    supported: hypotheses.filter((h) => h.state === 'supported').length,
    rejected: hypotheses.filter((h) => h.state === 'rejected').length,
    deferred: hypotheses.filter((h) => h.state === 'deferred').length,
    blocked: hypotheses.filter((h) => h.state === 'blocked').length,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg overflow-hidden font-sans select-none">
      {/* Subheader / Action Bar */}
      <div className="px-5 py-3 border-b border-border bg-surface flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search hypotheses, surfaces, or questions..."
              className="w-full pl-9 pr-3 py-1.5 bg-bg border border-border rounded-md text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <select
              value={selectedState}
              onChange={(e) => setSelectedState(e.target.value)}
              className="bg-bg border border-border rounded-md px-2 py-1.5 text-xs text-text focus:outline-none focus:border-accent"
            >
              <option value="all">All States ({stateCounts.all})</option>
              <option value="suspected">Suspected ({stateCounts.suspected})</option>
              <option value="supported">Supported ({stateCounts.supported})</option>
              <option value="rejected">Rejected ({stateCounts.rejected})</option>
              <option value="deferred">Deferred ({stateCounts.deferred})</option>
              <option value="blocked">Blocked ({stateCounts.blocked})</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-md border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
            title="Refresh hypotheses"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Formulate Hypothesis</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Loading Skeleton */}
        {isLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="h-28 bg-surface rounded-xl border border-border" />
            <div className="h-28 bg-surface rounded-xl border border-border" />
            <div className="h-28 bg-surface rounded-xl border border-border" />
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to load hypotheses</span>
            </div>
            <p className="text-text-muted">
              {isApiError(error) ? error.message : error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <button
              onClick={() => refetch()}
              className="px-2.5 py-1 rounded bg-surface border border-border text-text hover:bg-surface-2 transition-colors font-medium text-[11px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && hypotheses.length === 0 && (
          <div className="flex flex-col items-center justify-center p-12 text-center max-w-md mx-auto space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-surface-2 border border-border flex items-center justify-center text-text-muted">
              <HelpCircle className="w-6 h-6 text-accent" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-text">No Hypotheses Recorded</h3>
              <p className="text-xs text-text-muted leading-relaxed">
                A hypothesis is a security question, not a finding. Use hypotheses to formalize potential attack vectors, gather supporting evidence, and transition them when proven or ruled out.
              </p>
            </div>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Formulate First Hypothesis</span>
            </button>
          </div>
        )}

        {/* Filtered Empty State */}
        {!isLoading && !error && hypotheses.length > 0 && filteredHypotheses.length === 0 && (
          <div className="text-center py-12 text-xs text-text-muted space-y-2">
            <p>No hypotheses match the selected filters.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedState('all');
              }}
              className="text-accent underline hover:text-accent-hover"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Hypotheses Grid */}
        {!isLoading && !error && filteredHypotheses.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredHypotheses.map((hypothesis) => (
              <HypothesisCard
                key={hypothesis.id}
                hypothesis={hypothesis}
                projectId={projectId}
                onOpenTransition={(hyp) => setTransitionTarget(hyp)}
                onNavigateFinding={(findingId) => {
                  navigate(`/projects/${projectId}/findings/${findingId}`);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateHypothesisModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        sessionId={sessionId}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['hypotheses', sessionId] });
        }}
      />

      <TransitionHypothesisModal
        isOpen={Boolean(transitionTarget)}
        onClose={() => setTransitionTarget(null)}
        sessionId={sessionId}
        hypothesis={transitionTarget}
        onTransitioned={() => {
          queryClient.invalidateQueries({ queryKey: ['hypotheses', sessionId] });
        }}
      />
    </div>
  );
};
