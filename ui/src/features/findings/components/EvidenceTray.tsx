import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  FileCode, 
  Hash, 
  Copy, 
  Check, 
  AlertTriangle, 
  ExternalLink, 
  ArrowUp, 
  ArrowDown, 
  Trash2, 
  Plus, 
  X,
  Layers
} from 'lucide-react';
import { 
  Finding, 
  EvidenceItem, 
  EvidenceBinding, 
  EvidenceBindingRole, 
  Paginated 
} from '../../../api/types';
import { fetchJson, isApiError } from '../../../api/client';

interface EvidenceTrayProps {
  finding: Finding;
  evidence: EvidenceItem[];
  evidenceBindings?: EvidenceBinding[];
  evidenceIds?: string[];
  projectId: string;
  onEvidenceChange?: () => void;
}

const roleBadges: Record<EvidenceBindingRole, { label: string; className: string }> = {
  baseline: { 
    label: 'Baseline', 
    className: 'text-cyan-400 bg-cyan-500/15 border-cyan-500/30' 
  },
  proof: { 
    label: 'Proof', 
    className: 'text-danger bg-danger/15 border-danger/30' 
  },
  control: { 
    label: 'Control', 
    className: 'text-warning bg-warning/15 border-warning/30' 
  },
  verification: { 
    label: 'Verification', 
    className: 'text-success bg-success/15 border-success/30' 
  },
  supporting: { 
    label: 'Supporting', 
    className: 'text-text-muted bg-surface-2 border-border' 
  },
};

export const EvidenceTray: React.FC<EvidenceTrayProps> = ({
  finding,
  evidence,
  evidenceBindings,
  evidenceIds = finding.evidenceIds || [],
  projectId,
  onEvidenceChange,
}) => {
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Bind Evidence Modal State
  const [isBindModalOpen, setIsBindModalOpen] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<EvidenceBindingRole>('supporting');
  const [bindNote, setBindNote] = useState('');
  const [isBinding, setIsBinding] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  // Unbind Confirmation Modal State
  const [unbindConfirmTarget, setUnbindConfirmTarget] = useState<EvidenceBinding | null>(null);
  const [isUnbinding, setIsUnbinding] = useState(false);
  const [unbindError, setUnbindError] = useState<string | null>(null);

  // Reorder State
  const [isReordering, setIsReordering] = useState(false);

  // Fetch session recorded evidence for the picker
  const { data: sessionEvidenceData, isLoading: isLoadingSessionEvidence } = useQuery({
    queryKey: ['sessionEvidence', finding.sessionId],
    queryFn: () => fetchJson<Paginated<EvidenceItem>>(`/sessions/${finding.sessionId}/evidence`),
    enabled: isBindModalOpen && Boolean(finding.sessionId),
  });

  const sessionEvidenceList = sessionEvidenceData?.items || evidence;

  // Determine effective bindings
  const effectiveBindings: EvidenceBinding[] = React.useMemo(() => {
    if (evidenceBindings && evidenceBindings.length > 0) {
      return [...evidenceBindings].sort((a, b) => a.position - b.position);
    }
    // Fallback if detail only supplied evidenceIds
    return (finding.evidenceIds || evidenceIds).map((id, index) => ({
      findingId: finding.id,
      evidenceId: id,
      role: 'supporting' as EvidenceBindingRole,
      note: '',
      position: index,
    }));
  }, [evidenceBindings, finding.evidenceIds, evidenceIds, finding.id]);

  const handleCopyHash = (id: string, hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenBindModal = () => {
    setSelectedEvidenceId(null);
    setSelectedRole('supporting');
    setBindNote('');
    setBindError(null);
    setIsBindModalOpen(true);
  };

  const handleCloseBindModal = () => {
    setIsBindModalOpen(false);
    setSelectedEvidenceId(null);
    setBindNote('');
    setBindError(null);
  };

  const handleSubmitBind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEvidenceId || isBinding) return;

    setIsBinding(true);
    setBindError(null);

    try {
      await fetchJson(`/findings/${finding.id}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceId: selectedEvidenceId,
          role: selectedRole,
          note: bindNote.trim(),
          position: effectiveBindings.length,
        }),
      });

      // Invalidate queries to refresh finding detail and findings list
      await queryClient.invalidateQueries({ queryKey: ['findingDetail', finding.id] });
      await queryClient.invalidateQueries({ queryKey: ['findings'] });
      onEvidenceChange?.();
      handleCloseBindModal();
    } catch (err) {
      setBindError(isApiError(err) ? err.message : 'Failed to bind evidence');
    } finally {
      setIsBinding(false);
    }
  };

  const handleOpenUnbindConfirm = (binding: EvidenceBinding) => {
    setUnbindConfirmTarget(binding);
    setUnbindError(null);
  };

  const handleCloseUnbindConfirm = () => {
    setUnbindConfirmTarget(null);
    setUnbindError(null);
  };

  const handleConfirmUnbind = async () => {
    if (!unbindConfirmTarget || isUnbinding) return;

    setIsUnbinding(true);
    setUnbindError(null);

    try {
      await fetchJson(`/findings/${finding.id}/evidence/${unbindConfirmTarget.evidenceId}`, {
        method: 'DELETE',
      });

      await queryClient.invalidateQueries({ queryKey: ['findingDetail', finding.id] });
      await queryClient.invalidateQueries({ queryKey: ['findings'] });
      onEvidenceChange?.();
      handleCloseUnbindConfirm();
    } catch (err) {
      setUnbindError(isApiError(err) ? err.message : 'Failed to unbind evidence');
    } finally {
      setIsUnbinding(false);
    }
  };

  const handleMoveOrder = async (index: number, direction: 'up' | 'down') => {
    if (isReordering) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= effectiveBindings.length) return;

    const reordered = [...effectiveBindings];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    const orderedIds = reordered.map((b) => b.evidenceId);

    setIsReordering(true);
    try {
      await fetchJson(`/findings/${finding.id}/evidence/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          evidenceIds: orderedIds,
        }),
      });

      await queryClient.invalidateQueries({ queryKey: ['findingDetail', finding.id] });
      await queryClient.invalidateQueries({ queryKey: ['findings'] });
      onEvidenceChange?.();
    } catch (err) {
      console.error('Failed to reorder evidence:', err);
    } finally {
      setIsReordering(false);
    }
  };

  // Helper to find matching evidence item
  const findEvidenceItem = (id: string): EvidenceItem | undefined => {
    return evidence.find((e) => e.id === id) || sessionEvidenceList.find((e) => e.id === id);
  };

  const hasBindings = effectiveBindings.length > 0;
  const evidenceVersionNumber = finding.evidenceVersion ?? (hasBindings ? 1 : 0);

  return (
    <div className="space-y-3 font-sans">
      {/* Header with Title, Version Badge, Bind Action, and Workbench link */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted font-mono flex items-center gap-1.5">
            <FileCode className="w-3.5 h-3.5 text-accent" />
            <span>Recorded Evidence Tray ({effectiveBindings.length})</span>
          </h4>
          <span 
            data-testid="evidence-version"
            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-2 text-text-muted border border-border"
            title="Evidence set revision version"
          >
            Rev: v{evidenceVersionNumber}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="open-bind-modal-btn"
            onClick={handleOpenBindModal}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 text-[11px] font-mono transition-colors"
            title="Bind recorded session evidence artifact"
          >
            <Plus className="w-3 h-3" />
            <span>Bind Evidence</span>
          </button>

          <Link
            to={`/projects/${projectId}/workbench`}
            className="flex items-center gap-1 text-[11px] font-mono text-accent hover:underline ml-1"
          >
            <span>Workbench</span>
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Main Body: Warning when 0 evidence, or list of evidence bindings */}
      {!hasBindings ? (
        <div className="p-3.5 rounded-lg border border-warning/40 bg-warning/10 text-warning text-xs space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Missing Recorded Evidence</p>
              <p className="text-[11px] text-warning/90 mt-0.5 leading-relaxed">
                This finding has no recorded evidence artifacts attached. Governance policy strictly blocks transition to <strong>validated</strong> until at least one wire capture or verification receipt is pinned.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleOpenBindModal}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-warning/20 hover:bg-warning/30 text-warning font-mono text-[11px] font-semibold transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>Bind Recorded Evidence</span>
            </button>
            <Link
              to={`/projects/${projectId}/workbench`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-text-muted font-mono text-[11px] transition-colors"
            >
              Capture in Workbench &rarr;
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {effectiveBindings.map((binding, index) => {
            const evItem = findEvidenceItem(binding.evidenceId);
            const roleConfig = roleBadges[binding.role] || roleBadges.supporting;

            return (
              <div
                key={binding.evidenceId}
                data-testid={`evidence-card-${binding.evidenceId}`}
                className="p-3 bg-bg rounded-lg border border-border space-y-2 font-mono text-xs transition-colors hover:border-border/80"
              >
                {/* Top Row: Position, ID, Role Pill, Reorder & Unbind buttons */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-text-muted/60 font-semibold font-mono">
                      #{index + 1}
                    </span>
                    <span className="font-bold text-accent truncate">{binding.evidenceId}</span>
                    <span 
                      data-testid={`role-pill-${binding.evidenceId}`}
                      className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold border ${roleConfig.className}`}
                    >
                      {roleConfig.label}
                    </span>
                    {evItem?.kind && (
                      <span className="px-1.5 py-0.2 rounded bg-surface-2 text-[10px] text-text-muted border border-border uppercase">
                        {evItem.kind}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveOrder(index, 'up')}
                      disabled={index === 0 || isReordering}
                      className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      title="Move Up"
                      aria-label="Move Up"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveOrder(index, 'down')}
                      disabled={index === effectiveBindings.length - 1 || isReordering}
                      className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      title="Move Down"
                      aria-label="Move Down"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenUnbindConfirm(binding)}
                      className="p-1 rounded text-text-muted hover:text-danger hover:bg-danger/10 transition-colors ml-1"
                      title="Unbind evidence"
                      aria-label="Unbind evidence"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Summary */}
                <p className="font-sans text-xs text-text">
                  {evItem?.summary || 'No summary recorded for this artifact.'}
                </p>

                {/* Note if provided */}
                {binding.note && (
                  <div className="p-2 bg-surface-2/60 rounded border border-border/40 font-sans text-xs text-text-muted italic">
                    &ldquo;{binding.note}&rdquo;
                  </div>
                )}

                {/* Hash and Copy Action */}
                <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-border/50">
                  <div className="flex items-center gap-1.5 truncate max-w-[280px]">
                    <Hash className="w-3 h-3 text-text-muted shrink-0" />
                    <span className="truncate">{evItem?.hash || 'Hash pending'}</span>
                  </div>

                  {evItem?.hash && (
                    <button
                      type="button"
                      onClick={() => handleCopyHash(binding.evidenceId, evItem.hash || '')}
                      className="flex items-center gap-1 text-[11px] text-accent hover:underline shrink-0 ml-2"
                      title="Copy SHA-256 hash"
                    >
                      {copiedId === binding.evidenceId ? (
                        <>
                          <Check className="w-3 h-3 text-success" />
                          <span className="text-success">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── BIND EVIDENCE MODAL (Evidence Picker) ────────────────── */}
      {isBindModalOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-4 font-sans text-text animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-text">Bind Recorded Evidence</h3>
              </div>
              <button
                type="button"
                onClick={handleCloseBindModal}
                className="text-text-muted hover:text-text p-1 rounded-md hover:bg-surface-2 transition-colors"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-muted leading-relaxed">
              Select an existing recorded artifact from session <code className="text-accent bg-surface-2 px-1 py-0.5 rounded">{finding.sessionId}</code>.
              Governance policy prohibits arbitrary free-text evidence identifiers.
            </p>

            {bindError && (
              <div className="p-2.5 rounded bg-danger/10 border border-danger/30 text-danger text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{bindError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitBind} className="space-y-4">
              {/* Evidence Picker List */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text flex items-center justify-between">
                  <span>Recorded Session Evidence</span>
                  <span className="text-[10px] text-text-muted font-normal">Pick an artifact to bind</span>
                </label>

                {isLoadingSessionEvidence ? (
                  <div className="p-4 text-center text-xs text-text-muted bg-bg rounded-lg border border-border">
                    Loading recorded evidence artifacts...
                  </div>
                ) : sessionEvidenceList.length === 0 ? (
                  <div className="p-4 text-center text-xs text-text-muted bg-bg rounded-lg border border-border space-y-1">
                    <p className="font-semibold text-text">No recorded evidence in session</p>
                    <p className="text-[11px]">
                      Capture traffic in Workbench or record tool run receipts first.
                    </p>
                  </div>
                ) : (
                  <div 
                    data-testid="evidence-picker-list"
                    className="max-h-48 overflow-y-auto space-y-2 p-1 border border-border rounded-lg bg-bg"
                  >
                    {sessionEvidenceList.map((ev) => {
                      const isSelected = selectedEvidenceId === ev.id;
                      const isAlreadyBound = effectiveBindings.some((b) => b.evidenceId === ev.id);

                      return (
                        <div
                          key={ev.id}
                          onClick={() => {
                            if (!isAlreadyBound) {
                              setSelectedEvidenceId(ev.id);
                            }
                          }}
                          className={`p-2.5 rounded-md border text-xs cursor-pointer transition-all ${
                            isSelected
                              ? 'border-accent bg-accent/10 shadow-sm'
                              : isAlreadyBound
                              ? 'border-border/40 bg-surface-2/40 opacity-50 cursor-not-allowed'
                              : 'border-border bg-surface hover:border-accent/40'
                          }`}
                        >
                          <div className="flex items-center justify-between font-mono">
                            <div className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="selectedEvidence"
                                checked={isSelected}
                                disabled={isAlreadyBound}
                                onChange={() => setSelectedEvidenceId(ev.id)}
                                className="accent-accent"
                              />
                              <span className="font-bold text-accent">{ev.id}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              {isAlreadyBound && (
                                <span className="text-text-muted italic">Already bound</span>
                              )}
                              <span className="px-1.5 py-0.2 rounded bg-surface-2 text-text-muted uppercase border border-border">
                                {ev.kind}
                              </span>
                            </div>
                          </div>

                          <p className="font-sans text-xs text-text mt-1 line-clamp-2">
                            {ev.summary}
                          </p>

                          <div className="flex items-center gap-1 text-[10px] text-text-muted font-mono mt-1">
                            <Hash className="w-3 h-3 text-text-muted shrink-0" />
                            <span className="truncate">{ev.hash}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Role Selector */}
              <div className="space-y-1.5">
                <label 
                  htmlFor="evidence-role-select"
                  className="text-xs font-semibold text-text"
                >
                  Evidence Role
                </label>
                <select
                  id="evidence-role-select"
                  aria-label="Evidence Role"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as EvidenceBindingRole)}
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-xs text-text focus:outline-none focus:border-accent"
                >
                  <option value="supporting">Supporting (General corroborating context)</option>
                  <option value="proof">Proof (Exploit confirmation or payload execution)</option>
                  <option value="baseline">Baseline (Unprivileged or expected reference)</option>
                  <option value="control">Control (Sanitized or negative security control)</option>
                  <option value="verification">Verification (Differential or replay reproduction)</option>
                </select>
              </div>

              {/* Note Input */}
              <div className="space-y-1.5">
                <label 
                  htmlFor="evidence-note-input"
                  className="text-xs font-semibold text-text"
                >
                  Audit Note (Optional)
                </label>
                <input
                  id="evidence-note-input"
                  type="text"
                  placeholder="e.g. Exact HTTP response body confirming tenant isolation failure"
                  value={bindNote}
                  onChange={(e) => setBindNote(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-bg border border-border text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent"
                />
              </div>

              {/* Actions: Strict governance notes & Bind button */}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-border">
                <button
                  type="button"
                  onClick={handleCloseBindModal}
                  className="px-3 py-1.5 rounded-lg bg-surface-2 text-text hover:bg-surface-2/80 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-bind-btn"
                  disabled={!selectedEvidenceId || isBinding}
                  className="px-4 py-1.5 rounded-lg bg-accent text-accent-fg hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold shadow-sm transition-colors"
                >
                  {isBinding ? 'Binding...' : 'Bind Evidence'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── UNBIND CONFIRMATION MODAL ────────────────────────────── */}
      {unbindConfirmTarget && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4 font-sans text-text animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-danger">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-semibold">Unbind Evidence Artifact</h3>
            </div>

            <p className="text-xs text-text leading-relaxed">
              Are you sure you want to unbind evidence <strong className="font-mono text-accent">{unbindConfirmTarget.evidenceId}</strong> ({unbindConfirmTarget.role}) from this finding?
            </p>

            <p className="text-[11px] text-text-muted">
              Unbinding this artifact will increment the finding&apos;s evidence revision version and may impact validation governance requirements if no other evidence artifacts remain.
            </p>

            {unbindError && (
              <div className="p-2.5 rounded bg-danger/10 border border-danger/30 text-danger text-xs">
                {unbindError}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-border">
              <button
                type="button"
                onClick={handleCloseUnbindConfirm}
                disabled={isUnbinding}
                className="px-3 py-1.5 rounded-lg bg-surface-2 text-text hover:bg-surface-2/80 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUnbind}
                disabled={isUnbinding}
                className="px-3.5 py-1.5 rounded-lg bg-danger text-danger-fg hover:bg-danger/90 disabled:opacity-40 text-xs font-semibold shadow-sm transition-colors"
              >
                {isUnbinding ? 'Unbinding...' : 'Confirm Unbind'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
