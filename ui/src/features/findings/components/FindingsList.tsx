import React from 'react';
import { Search, CheckCircle2, XCircle, AlertTriangle, FileCode, Inbox, RotateCcw } from 'lucide-react';
import { Finding, FindingSeverity, FindingState } from '../../../api/types';

interface FindingsListProps {
  findings: Finding[];
  selectedFindingId: string | null;
  onSelectFinding: (finding: Finding) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedState: string;
  onSelectState: (s: string) => void;
  selectedSeverity: string;
  onSelectSeverity: (sev: string) => void;
  onResetFilters: () => void;
  projectId: string;
}

export const FindingsList: React.FC<FindingsListProps> = ({
  findings,
  selectedFindingId,
  onSelectFinding,
  searchQuery,
  onSearchChange,
  selectedState,
  onSelectState,
  selectedSeverity,
  onSelectSeverity,
  onResetFilters,
  projectId,
}) => {
  const severities: Array<'ALL' | FindingSeverity> = ['ALL', 'critical', 'high', 'medium', 'low', 'info'];
  const states: Array<'ALL' | 'candidate' | 'validated' | 'rejected'> = ['ALL', 'candidate', 'validated', 'rejected'];

  const hasActiveFilters = searchQuery !== '' || selectedState !== 'ALL' || selectedSeverity !== 'ALL';

  const getSeverityBadge = (severity: FindingSeverity) => {
    switch (severity) {
      case 'critical':
        return 'text-danger bg-danger/15 border-danger/30';
      case 'high':
        return 'text-warning bg-warning/15 border-warning/30';
      case 'medium':
        return 'text-accent bg-accent/15 border-accent/30';
      case 'low':
      case 'info':
      default:
        return 'text-text-muted bg-surface-2 border-border';
    }
  };

  const getStateBadge = (state: FindingState) => {
    switch (state) {
      case 'validated':
        return (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-success/15 border border-success/30 text-success">
            <CheckCircle2 className="w-3 h-3" />
            <span>Validated</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-danger/15 border border-danger/30 text-danger">
            <XCircle className="w-3 h-3" />
            <span>Rejected</span>
          </span>
        );
      case 'candidate':
      case 'observed':
      case 'suspected':
      case 'experiment_planned':
      case 'reproduced':
      default:
        return (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-warning/10 border border-warning/30 text-warning">
            <AlertTriangle className="w-3 h-3" />
            <span>Candidate</span>
          </span>
        );
    }
  };

  return (
    <div className="w-96 border-r border-border bg-surface flex flex-col min-h-0 select-none font-sans shrink-0">
      {/* Search & Filter Header */}
      <div className="p-3 border-b border-border space-y-2 bg-surface">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search findings, VRT, asset..."
            className="w-full bg-bg border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent font-mono"
          />
        </div>

        {/* State Dropdown & Severity Pills */}
        <div className="flex items-center justify-between gap-2">
          {/* State Filter */}
          <select
            value={selectedState}
            onChange={(e) => onSelectState(e.target.value)}
            className="bg-bg border border-border rounded px-2 py-1 text-xs text-text font-mono focus:outline-none focus:border-accent"
          >
            {states.map((st) => (
              <option key={st} value={st}>
                {st === 'ALL' ? 'State: All' : `State: ${st}`}
              </option>
            ))}
          </select>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              onClick={onResetFilters}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline font-mono"
              title="Reset Filters"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {/* Severity Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[10px] font-mono">
          <span className="text-text-muted pr-1">Sev:</span>
          {severities.map((sev) => (
            <button
              key={sev}
              onClick={() => onSelectSeverity(sev)}
              className={`px-1.5 py-0.5 rounded border transition-colors ${
                selectedSeverity === sev
                  ? 'bg-accent/20 border-accent/40 text-accent font-semibold'
                  : 'bg-bg border-border text-text-muted hover:text-text'
              }`}
            >
              {sev.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Findings List */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {findings.length === 0 ? (
          <div className="p-6 text-center text-text-muted space-y-3">
            <Inbox className="w-8 h-8 opacity-40 mx-auto" />
            <h4 className="text-xs font-semibold text-text">No findings match</h4>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Findings require observed evidence and reproducible security boundary violation.
            </p>
            {hasActiveFilters ? (
              <button
                onClick={onResetFilters}
                className="text-xs text-accent hover:underline font-mono"
              >
                Clear all filters
              </button>
            ) : (
              <a
                href={`/projects/${projectId}/workbench`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline font-mono"
              >
                Capture evidence in Workbench &rarr;
              </a>
            )}
          </div>
        ) : (
          findings.map((f) => {
            const isSelected = selectedFindingId === f.id;
            const evidenceCount = f.evidenceIds?.length || 0;

            return (
              <div
                key={f.id}
                onClick={() => onSelectFinding(f)}
                className={`p-3 cursor-pointer transition-colors relative border-l-2 ${
                  isSelected
                    ? 'bg-accent/15 border-l-accent'
                    : 'bg-surface hover:bg-surface-2/60 border-l-transparent'
                }`}
              >
                {/* Row 1: ID, Severity & State */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-[10px] font-mono text-text-muted truncate">
                      {f.id}
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold uppercase border tracking-wider ${getSeverityBadge(
                        f.severity
                      )}`}
                    >
                      {f.severity}
                    </span>
                  </div>

                  {getStateBadge(f.state)}
                </div>

                {/* Row 2: Title */}
                <h4 className="text-xs font-medium text-text line-clamp-1 mb-1">
                  {f.title}
                </h4>

                {/* Row 3: Asset path */}
                <p className="text-[11px] font-mono text-text-muted truncate mb-1.5">
                  {f.asset}
                </p>

                {/* Row 4: Evidence Pill & VRT Tag */}
                <div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
                  <span className="truncate max-w-[150px]">{f.vrt}</span>

                  <span
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                      evidenceCount > 0
                        ? 'bg-surface-2 text-text-muted border-border'
                        : 'bg-warning/10 text-warning border-warning/30 font-semibold'
                    }`}
                    title={
                      evidenceCount > 0
                        ? `${evidenceCount} recorded evidence artifacts linked`
                        : 'No evidence linked: validation will be blocked'
                    }
                  >
                    <FileCode className="w-3 h-3" />
                    <span>{evidenceCount} ev</span>
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer stats */}
      <div className="p-2.5 border-t border-border bg-bg/50 text-[11px] font-mono text-text-muted flex items-center justify-between">
        <span>Showing {findings.length} findings</span>
        <span>M4 Gate</span>
      </div>
    </div>
  );
};
