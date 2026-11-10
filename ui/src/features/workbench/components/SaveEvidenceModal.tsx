import React, { useState, useEffect } from 'react';
import { BookmarkPlus, X, Check } from 'lucide-react';
import { CapturedRequest } from '../../../api/types';
import { fetchJson } from '../../../api/client';

interface SaveEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  request: CapturedRequest | null;
  onSaved: (evidenceId: string) => void;
}

export const SaveEvidenceModal: React.FC<SaveEvidenceModalProps> = ({
  isOpen,
  onClose,
  request,
  onSaved,
}) => {
  const [hypothesisId, setHypothesisId] = useState('hyp_01');
  const [taskId, setTaskId] = useState('tsk_idor_01');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && request) {
      setNote(`Observed HTTP ${request.method} ${request.path} [${request.status}]: confirmed behavior.`);
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
    try {
      const res = await fetchJson<{ id: string }>('/workbench/evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: request.id,
          responseId: `resp_${request.id}`,
          hypothesisId,
          taskId: taskId || undefined,
          note,
        }),
      });
      onSaved(res.id);
      onClose();
    } catch {
      // Handled
    } finally {
      setIsSubmitting(false);
    }
  };

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
                Pin HTTP capture to project hypotheses and audit trails
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
          {/* Target Request Info */}
          <div className="p-3 bg-bg rounded-lg border border-border font-mono text-[11px] space-y-1">
            <span className="text-[10px] text-text-muted uppercase">Captured Target</span>
            <div className="flex items-center gap-2 truncate">
              <span className="font-bold text-accent">{request.method}</span>
              <span className="text-text truncate">{request.path}</span>
              <span className="text-text-muted">[{request.status}]</span>
            </div>
          </div>

          {/* Hypothesis Select */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text">Link to Hypothesis</label>
            <select
              value={hypothesisId}
              onChange={(e) => setHypothesisId(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-accent font-sans"
            >
              <option value="hyp_01">hyp_01: Cross-tenant IDOR on /invoices</option>
              <option value="hyp_02">hyp_02: Broken Object Level Authorization on /users</option>
              <option value="hyp_03">hyp_03: Unauthenticated state-changing refund</option>
            </select>
          </div>

          {/* Task Select */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text">Associated Task (Optional)</label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full bg-bg border border-border rounded-lg px-2.5 py-1.5 text-xs text-text focus:outline-none focus:border-accent font-sans"
            >
              <option value="tsk_idor_01">tsk_idor_01: IDOR verification sweep</option>
              <option value="">None / Manual Analysis</option>
            </select>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-text">Operator Finding Rationale</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Detail the significance of this request/response for the final report..."
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
