import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookmarkPlus, X, Check, AlertCircle } from 'lucide-react';
import { CapturedRequest, Paginated } from '../../../api/types';
import { fetchJson, isApiError } from '../../../api/client';

interface SaveEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: CapturedRequest | null;
  onSaved: (evidenceId: string) => void;
  projectId?: string;
  sessionId?: string;
}

export const SaveEvidenceModal: React.FC<SaveEvidenceModalProps> = ({
  isOpen,
  onClose,
  request,
  onSaved,
  projectId,
  sessionId,
}) => {
  const [selectedFindingId, setSelectedFindingId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Query findings for the project to link evidence
  const { data: findingsData } = useQuery({
    queryKey: ['findings', projectId],
    queryFn: () => fetchJson<Paginated<{ id: string; title: string; severity: string }>>(`/findings${projectId ? `?projectId=${projectId}` : ''}`),
    enabled: Boolean(isOpen),
  });

  // Query tasks for active session if available
  const { data: tasksData } = useQuery({
    queryKey: ['sessionTasks', sessionId],
    queryFn: () => fetchJson<Paginated<{ id: string; title: string; kind: string }>>(`/sessions/${sessionId}/tasks`),
    enabled: Boolean(isOpen && sessionId),
  });

  useEffect(() => {
    if (isOpen && request) {
      setNote(`Observed HTTP ${request.method} ${request.path} [${request.status}]: confirmed behavior.`);
      setSaveError(null);
    }
  }, [isOpen, request]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !request) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSaveError(null);
    try {
      const res = await fetchJson<{ id: string }>('/workbench/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          responseId: `resp_${request.id}`,
          hypothesisId: undefined, // Hypotheses not yet implemented (Phase 3)
          findingId: selectedFindingId || undefined,
          taskId: selectedTaskId || undefined,
          note,
        }),
      });
      onSaved(res.id);
      onClose();
    } catch (err) {
      setSaveError(isApiError(err) ? err.message : 'Failed to save evidence artifact.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const findingsList = findingsData?.items || [];
  const tasksList = tasksData?.items || [];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-evidence-title"
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-text">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg border bg-accent/15 border-accent/30 text-accent">
              <BookmarkPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 id="save-evidence-title" className="text-sm font-semibold text-text">
                Save as Artifact Evidence
              </h3>
              <p className="text-[11px] text-text-muted">
                Pin HTTP capture to project findings and audit trails
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-surface-2 transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {saveError && (
            <div className="bg-danger/15 border border-danger/30 rounded-lg p-2.5 flex items-start gap-2 text-danger font-mono text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Evidence Save Failed</p>
                <p className="text-[11px] text-danger/80 pt-0.5">{saveError}</p>
              </div>
            </div>
          )}

          {/* Target Request Info */}
          <div className="p-3 bg-bg rounded-lg border border-border font-mono text-[11px] space-y-1">
            <span className="text-[10px] text-text-muted uppercase">Captured Target</span>
            <div className="flex items-center gap-2 truncate">
              <span className="font-bold text-accent">{request.method}</span>
              <span className="text-text truncate">{request.path}</span>
              <span className="text-text-muted">[{request.status}]</span>
            </div>
          </div>

          {/* Hypothesis Select - Disabled with honest state */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text">Link to Hypothesis</label>
              <span className="text-[10px] text-text-muted font-mono bg-surface-2 px-1.5 py-0.5 rounded border border-border">
                Not available yet (Phase 3)
              </span>
            </div>
            <select
              value=""
              disabled
              className="w-full bg-bg/50 border border-border/60 rounded-lg px-2.5 py-1.5 text-xs text-text-muted font-sans cursor-not-allowed opacity-75"
            >
              <option value="">(Hypothesis tracking not yet available)</option>
            </select>
          </div>

          {/* Finding Picker */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text">Associated Finding (Optional)</label>
            <select
              value={selectedFindingId}
              onChange={(e) => setSelectedFindingId(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-accent font-sans"
            >
              <option value="">None / Standalone Evidence</option>
              {findingsList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}: {f.title} ({f.severity})
                </option>
              ))}
            </select>
          </div>

          {/* Task Select Picker */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text">Associated Task (Optional)</label>
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-accent font-sans"
            >
              <option value="">None / Manual Analysis</option>
              {tasksList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id}: {t.title} ({t.kind})
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text">Operator Finding Rationale</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Detail the significance of this request/response for the audit trail..."
              className="w-full bg-bg border border-border rounded-lg p-2.5 text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent font-sans"
            />
          </div>

          {/* Footer */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 text-xs font-medium text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Saving...' : 'Pin Evidence'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
