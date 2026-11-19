import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, Copy, Check, Plus, MessageSquare, ArrowRight, 
  ArrowLeft, Network, FlaskConical, Wrench, ExternalLink,
  ShieldCheck, AlertCircle, RotateCw
} from 'lucide-react';
import { 
  AppEntity, 
  AppEdge, 
  NoteItem, 
  CoverageEntry, 
  CoverageGap, 
  RecordCoveragePayload, 
  CoverageOutcome 
} from '../../../api/types';
import { appEntityView } from '../appEntityView';

interface EntityDetailDrawerProps {
  entity: (AppEntity & {
    coverage?: {
      tested: boolean;
      outcomes: Record<string, number>;
      lastTestedAt: string | null;
      entries: CoverageEntry[];
    };
    findingCount?: number;
  }) | null;
  edges: AppEdge[];
  notes: NoteItem[];
  allEntities: AppEntity[];
  coverageData?: {
    entries?: number | CoverageEntry[];
    outcomes?: Record<string, number>;
    lastTestedAt?: string | null;
    gaps?: CoverageGap[];
  } | null;
  onClose: () => void;
  onSelectEntity: (entity: AppEntity) => void;
  onFilterGraphToNeighbors?: (entityId: string) => void;
  onAddNote: (entityId: string, content: string) => Promise<void>;
  onRecordCoverage?: (entityId: string, payload: RecordCoveragePayload) => Promise<void>;
}

export const EntityDetailDrawer: React.FC<EntityDetailDrawerProps> = ({
  entity,
  edges,
  notes,
  allEntities,
  coverageData,
  onClose,
  onSelectEntity,
  onFilterGraphToNeighbors,
  onAddNote,
  onRecordCoverage,
}) => {
  const navigate = useNavigate();
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Coverage Form State
  const [isRecordFormOpen, setIsRecordFormOpen] = useState(false);
  const [coverageRiskArea, setCoverageRiskArea] = useState('idor');
  const [coverageOutcome, setCoverageOutcome] = useState<CoverageOutcome>('no_issue_found');
  const [coverageSurface, setCoverageSurface] = useState('');
  const [coverageEvidenceId, setCoverageEvidenceId] = useState('');
  const [coverageReason, setCoverageReason] = useState('');
  const [coverageWorker, setCoverageWorker] = useState('operator');
  const [isSubmittingCoverage, setIsSubmittingCoverage] = useState(false);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  if (!entity) return null;

  const view = appEntityView(entity);
  const Icon = view.icon;

  const handleCopyId = () => {
    navigator.clipboard.writeText(entity.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(entity, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || isSubmittingNote) return;

    setIsSubmittingNote(true);
    try {
      await onAddNote(entity.id, newNoteContent.trim());
      setNewNoteContent('');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const effectiveCoverage = entity?.coverage || coverageData || null;
  const entries: CoverageEntry[] = Array.isArray(entity?.coverage?.entries)
    ? entity.coverage.entries
    : Array.isArray(coverageData?.entries)
    ? coverageData.entries
    : [];
  const gaps: CoverageGap[] = coverageData?.gaps || [];

  const entityGaps = gaps.filter((g) => g.entityId === entity.id);
  const hasMissingEvidenceGap = entries.some(
    (e) => e.outcome === 'no_issue_found' && !e.evidenceId
  );
  const hasNeedsFollowUpGap = entries.some((e) => e.outcome === 'needs_follow_up');
  const hasMissingReasonGap = entries.some(
    (e) => ['ruled_out', 'not_applicable'].includes(e.outcome) && !e.reason
  );

  const handleRecordCoverageSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRecordCoverage || isSubmittingCoverage) return;
    setCoverageError(null);
    setIsSubmittingCoverage(true);
    try {
      await onRecordCoverage(entity.id, {
        riskArea: coverageRiskArea,
        outcome: coverageOutcome,
        surface: coverageSurface.trim() || entity.name,
        evidenceId: coverageEvidenceId.trim() || undefined,
        reason: coverageReason.trim() || undefined,
        worker: coverageWorker.trim() || 'operator',
      });
      setIsRecordFormOpen(false);
      setCoverageEvidenceId('');
      setCoverageReason('');
    } catch (err) {
      setCoverageError(err instanceof Error ? err.message : 'Failed to record coverage');
    } finally {
      setIsSubmittingCoverage(false);
    }
  };

  // Incoming and outgoing edges for this entity
  const incomingEdges = edges.filter((edg) => edg.targetId === entity.id);
  const outgoingEdges = edges.filter((edg) => edg.sourceId === entity.id);

  const getEntityById = (id: string) => allEntities.find((e) => e.id === id);

  return (
    <aside className="w-96 border-l border-border bg-surface flex flex-col shrink-0 h-full font-sans select-none overflow-hidden shadow-2xl z-20">
      {/* 1. Header with Close Button */}
      <div className="p-4 border-b border-border flex items-start justify-between gap-3 bg-surface/90 shrink-0">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-bg border border-border text-accent shrink-0 mt-0.5">
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted">
                {view.kindLabel}
              </span>
              <span className="text-[10px] font-mono text-text-muted/60">rev.{entity.revision}</span>
            </div>
            <h2 className="text-sm font-semibold text-text truncate" title={entity.name}>
              {entity.name}
            </h2>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
          title="Close details drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Scrollable Drawer Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs font-mono">
        {/* Entity ID & Badges Banner */}
        <div className="space-y-2 bg-bg/60 p-3 rounded-lg border border-border">
          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span className="text-[10px] uppercase tracking-wider">Entity ID:</span>
            <div 
              onClick={handleCopyId}
              className="flex items-center gap-1 text-accent hover:underline cursor-pointer"
              title="Copy ID"
            >
              <span>{entity.id}</span>
              {copiedId ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 opacity-60" />}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${view.confidenceBadgeClass}`}>
              {view.confidence}
            </span>
            {view.isStale && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-warning/20 text-warning border border-warning/40">
                STALE
              </span>
            )}
            {view.hasAuthBoundary && (
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-accent/15 text-accent border border-accent/30">
                AUTH BOUNDARY
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-text-muted/80 pt-1 border-t border-border/40">
            <span>First seen: {new Date(entity.firstSeen).toLocaleDateString()}</span>
            <span>Last seen: {new Date(entity.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        {/* Kind-Specific Structured Metadata */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Attributes & Meta
          </h3>

          <div className="bg-bg/40 rounded-lg border border-border divide-y divide-border/40">
            {view.metaFields.length === 0 ? (
              <p className="p-3 text-[11px] text-text-muted italic">No specific attributes configured.</p>
            ) : (
              view.metaFields.map((field, idx) => (
                <div key={idx} className="p-2.5 flex items-start justify-between gap-2 text-[11px]">
                  <span className="text-text-muted font-medium shrink-0">{field.label}:</span>
                  <span className="text-text text-right font-mono truncate" title={field.value}>
                    {field.value}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Tags */}
        {entity.tags.length > 0 && (
          <div className="space-y-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Tags</h3>
            <div className="flex flex-wrap gap-1">
              {entity.tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded bg-bg text-text-muted border border-border text-[10px]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Connected Topology Edges */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Connected Edges ({incomingEdges.length + outgoingEdges.length})
          </h3>

          <div className="space-y-2">
            {/* Incoming */}
            {incomingEdges.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Incoming</span>
                {incomingEdges.map((edg) => {
                  const source = getEntityById(edg.sourceId);
                  return (
                    <div
                      key={edg.id}
                      onClick={() => source && onSelectEntity(source)}
                      className="p-2 rounded bg-bg border border-border hover:border-accent/50 cursor-pointer transition-colors flex items-center justify-between text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowLeft className="w-3 h-3 text-text-muted shrink-0" />
                        <span className="text-text truncate">{source?.name || edg.sourceId}</span>
                      </div>
                      <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-surface-2 border border-border shrink-0">
                        {edg.relation}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Outgoing */}
            {outgoingEdges.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-text-muted uppercase tracking-wider">Outgoing</span>
                {outgoingEdges.map((edg) => {
                  const target = getEntityById(edg.targetId);
                  return (
                    <div
                      key={edg.id}
                      onClick={() => target && onSelectEntity(target)}
                      className="p-2 rounded bg-bg border border-border hover:border-accent/50 cursor-pointer transition-colors flex items-center justify-between text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <ArrowRight className="w-3 h-3 text-text-muted shrink-0" />
                        <span className="text-text truncate">{target?.name || edg.targetId}</span>
                      </div>
                      <span className="text-[10px] text-accent px-1.5 py-0.5 rounded bg-surface-2 border border-border shrink-0">
                        {edg.relation}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {incomingEdges.length === 0 && outgoingEdges.length === 0 && (
              <p className="p-3 bg-bg/40 border border-dashed border-border rounded text-[11px] text-text-muted italic text-center">
                Isolated entity with no direct edges.
              </p>
            )}
          </div>
        </div>

        {/* Coverage & Verification Ledger */}
        <div className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              <span>Coverage Ledger ({entries.length})</span>
            </h3>
            {onRecordCoverage && (
              <button
                onClick={() => setIsRecordFormOpen(!isRecordFormOpen)}
                className="flex items-center gap-1 text-[11px] text-accent hover:underline"
              >
                <Plus className="w-3 h-3" />
                <span>{isRecordFormOpen ? 'Cancel' : 'Record'}</span>
              </button>
            )}
          </div>

          {/* Coverage Status Summary */}
          <div className="p-2.5 rounded-lg bg-bg/60 border border-border space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-text-muted">Verification State:</span>
              {entries.length > 0 ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-success/15 text-success border border-success/30">
                  TESTED ({entries.length} checks)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-2 text-text-muted border border-border">
                  UNTESTED
                </span>
              )}
            </div>

            {effectiveCoverage?.lastTestedAt && (
              <div className="flex items-center justify-between text-[10px] text-text-muted/80">
                <span>Last tested:</span>
                <span className="font-mono">{new Date(effectiveCoverage.lastTestedAt).toLocaleString()}</span>
              </div>
            )}

            {/* Outcome Badges Breakdown */}
            {effectiveCoverage?.outcomes && Object.keys(effectiveCoverage.outcomes).length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
                {Object.entries(effectiveCoverage.outcomes).map(([outcome, count]) => {
                  const badgeClass =
                    outcome === 'no_issue_found'
                      ? 'bg-success/15 text-success border-success/30'
                      : outcome === 'reported'
                      ? 'bg-danger/15 text-danger border-danger/30'
                      : outcome === 'needs_follow_up'
                      ? 'bg-warning/20 text-warning border-warning/40'
                      : 'bg-surface-2 text-text-muted border-border';
                  return (
                    <span key={outcome} className={`px-1.5 py-0.5 rounded text-[9px] font-mono border ${badgeClass}`}>
                      {outcome.replace('_', ' ')}: {count}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Gaps Warnings */}
          {(hasMissingEvidenceGap || entityGaps.some((g) => g.kind === 'missing_evidence')) && (
            <div className="p-2.5 rounded-lg bg-warning/15 border border-warning/40 text-warning text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Coverage Gap (Missing Evidence):</strong> 'No issue found' recorded without supporting evidence artifact ID. A recorded traffic artifact is required to prove negative verification.
              </div>
            </div>
          )}

          {(hasNeedsFollowUpGap || entityGaps.some((g) => g.kind === 'needs_follow_up')) && (
            <div className="p-2.5 rounded-lg bg-warning/15 border border-warning/40 text-warning text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Coverage Gap (Needs Follow-Up):</strong> Further investigation or test turn required for this attack surface.
              </div>
            </div>
          )}

          {(hasMissingReasonGap || entityGaps.some((g) => g.kind === 'missing_reason')) && (
            <div className="p-2.5 rounded-lg bg-warning/15 border border-warning/40 text-warning text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <strong>Coverage Gap (Missing Reason):</strong> Rationale required when marking attack surface as ruled out or not applicable.
              </div>
            </div>
          )}

          {/* Record Coverage Form */}
          {isRecordFormOpen && onRecordCoverage && (
            <form onSubmit={handleRecordCoverageSubmit} className="p-3 rounded-lg bg-bg border border-accent/40 space-y-2.5 font-sans">
              <div className="flex items-center justify-between text-xs font-semibold text-text">
                <span>Record Security Coverage</span>
                <button
                  type="button"
                  onClick={() => setIsRecordFormOpen(false)}
                  className="text-text-muted hover:text-text"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {coverageError && (
                <div className="text-[11px] text-danger font-mono bg-danger/10 p-1.5 rounded border border-danger/30">
                  {coverageError}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-text-muted">Risk Area</label>
                <input
                  type="text"
                  value={coverageRiskArea}
                  onChange={(e) => setCoverageRiskArea(e.target.value)}
                  placeholder="e.g. idor, sqli, auth_bypass, ssrf, xss"
                  className="w-full px-2 py-1 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-text-muted">Outcome</label>
                <select
                  value={coverageOutcome}
                  onChange={(e) => setCoverageOutcome(e.target.value as CoverageOutcome)}
                  className="w-full px-2 py-1 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                >
                  <option value="no_issue_found">no_issue_found (verified clean)</option>
                  <option value="reported">reported (finding identified)</option>
                  <option value="needs_follow_up">needs_follow_up (requires retest)</option>
                  <option value="ruled_out">ruled_out (safely dismissed)</option>
                  <option value="not_applicable">not_applicable (out of scope)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-text-muted">Surface</label>
                <input
                  type="text"
                  value={coverageSurface}
                  onChange={(e) => setCoverageSurface(e.target.value)}
                  placeholder={entity.name}
                  className="w-full px-2 py-1 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-text-muted">
                  Evidence ID {coverageOutcome === 'no_issue_found' && <span className="text-warning">(Required for clean proof)</span>}
                </label>
                <input
                  type="text"
                  value={coverageEvidenceId}
                  onChange={(e) => setCoverageEvidenceId(e.target.value)}
                  placeholder="evd_... or flow request ID"
                  className="w-full px-2 py-1 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-text-muted">Reason / Justification</label>
                <input
                  type="text"
                  value={coverageReason}
                  onChange={(e) => setCoverageReason(e.target.value)}
                  placeholder="Verification method or justification rationale"
                  className="w-full px-2 py-1 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-mono text-text-muted">Worker</label>
                <input
                  type="text"
                  value={coverageWorker}
                  onChange={(e) => setCoverageWorker(e.target.value)}
                  placeholder="operator"
                  className="w-full px-2 py-1 rounded bg-surface border border-border text-text font-mono text-xs focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsRecordFormOpen(false)}
                  className="px-2.5 py-1 rounded bg-surface-2 text-text-muted hover:text-text text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  onClick={handleRecordCoverageSubmit}
                  disabled={isSubmittingCoverage}
                  className="flex items-center gap-1 px-3 py-1 rounded bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors disabled:opacity-40"
                >
                  {isSubmittingCoverage ? <RotateCw className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                  <span>{isSubmittingCoverage ? 'Saving…' : 'Record Coverage'}</span>
                </button>
              </div>
            </form>
          )}

          {/* Coverage Entries Table */}
          {entries.length > 0 ? (
            <div className="space-y-2">
              <div className="bg-bg/40 rounded-lg border border-border divide-y divide-border/40">
                {entries.map((entry) => (
                  <div key={entry.id} className="p-2.5 space-y-1 text-[11px] font-mono">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-text uppercase text-[10px] tracking-wider">
                        {entry.riskArea}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${
                          entry.outcome === 'no_issue_found'
                            ? 'bg-success/15 text-success border-success/30'
                            : entry.outcome === 'reported'
                            ? 'bg-danger/15 text-danger border-danger/30'
                            : entry.outcome === 'needs_follow_up'
                            ? 'bg-warning/20 text-warning border-warning/40'
                            : 'bg-surface-2 text-text-muted border-border'
                        }`}
                      >
                        {entry.outcome}
                      </span>
                    </div>

                    <div className="text-[10px] text-text-muted truncate" title={entry.surface}>
                      Surface: {entry.surface}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-text-muted/70">
                      <span>Evidence: {entry.evidenceId || <span className="text-warning italic">None</span>}</span>
                      <span>Worker: {entry.worker || 'operator'}</span>
                    </div>

                    {entry.reason && (
                      <p className="text-[10px] text-text-muted bg-surface/40 p-1 rounded font-sans italic">
                        {entry.reason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="p-3 bg-bg/40 border border-dashed border-border rounded text-[11px] text-text-muted italic text-center">
              No coverage records logged for this entity yet.
            </p>
          )}
        </div>

        {/* Analyst Notes Section */}
        <div className="space-y-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-accent" />
              <span>Notes ({notes.length})</span>
            </h3>
          </div>

          {/* Add Note Form */}
          <form onSubmit={handleAddNoteSubmit} className="space-y-1.5">
            <textarea
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              placeholder="Add observation note..."
              rows={2}
              className="w-full p-2 bg-bg border border-border rounded text-text font-mono text-xs placeholder:text-text-muted/50 focus:outline-none focus:border-accent resize-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!newNoteContent.trim() || isSubmittingNote}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                <span>Add Note</span>
              </button>
            </div>
          </form>

          {/* Notes List */}
          <div className="space-y-2 pt-1">
            {notes.map((note) => (
              <div key={note.id} className="p-2.5 rounded bg-bg border border-border space-y-1">
                <p className="text-[11px] text-text leading-relaxed font-sans">{note.content}</p>
                <span className="text-[9px] text-text-muted/60 block text-right">
                  {new Date(note.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions Menu */}
        <div className="space-y-2 pt-2 border-t border-border">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Entity Actions
          </h3>

          <div className="grid grid-cols-1 gap-1.5">
            {/* Copy JSON */}
            <button
              onClick={handleCopyJson}
              className="flex items-center justify-between px-3 py-2 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text transition-colors text-xs"
            >
              <span>Copy Entity JSON</span>
              {copiedJson ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 text-text-muted" />}
            </button>

            {/* Filter Graph to Neighbors */}
            {onFilterGraphToNeighbors && (
              <button
                onClick={() => onFilterGraphToNeighbors(entity.id)}
                className="flex items-center justify-between px-3 py-2 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text transition-colors text-xs"
                title="Filter graph to this entity and its connected neighborhood"
              >
                <span>Filter Graph to Neighbors</span>
                <Network className="w-3.5 h-3.5 text-accent" />
              </button>
            )}

            {/* Open in Workbench */}
            <button
              onClick={() => navigate(`/projects/${entity.projectId}/workbench`)}
              className="flex items-center justify-between px-3 py-2 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-text transition-colors text-xs"
              title="Open captured traffic and replay in Workbench"
            >
              <div className="flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-accent" />
                <span>Open in Workbench</span>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            </button>

            {/* Placeholder: Create Hypothesis (M3) */}
            <button
              disabled
              className="flex items-center justify-between px-3 py-2 rounded bg-bg border border-border/40 text-text-muted/50 cursor-not-allowed text-xs"
              title="Available in Milestone 3: Hypothesis Testing"
            >
              <div className="flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Create Hypothesis</span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-2 border border-border/40 text-text-muted/40">
                M3
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
