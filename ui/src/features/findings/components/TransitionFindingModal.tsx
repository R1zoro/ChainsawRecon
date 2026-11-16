import React, { useState, useEffect } from 'react';
import { X, Check, AlertCircle, AlertTriangle, ShieldCheck, ShieldX } from 'lucide-react';
import { Finding } from '../../../api/types';
import { fetchJson, isApiError } from '../../../api/client';

interface TransitionFindingModalProps {
  isOpen: boolean;
  onClose: () => void;
  finding: Finding | null;
  onTransitionSuccess: (updated: Finding) => void;
}

export const TransitionFindingModal: React.FC<TransitionFindingModalProps> = ({
  isOpen,
  onClose,
  finding,
  onTransitionSuccess,
}) => {
  const [targetState, setTargetState] = useState<'validated' | 'rejected' | 'candidate'>('validated');
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setReason('');
      if (finding?.state === 'candidate') {
        setTargetState('validated');
      } else if (finding?.state === 'validated') {
        setTargetState('rejected');
      } else {
        setTargetState('candidate');
      }
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !finding) return null;

  const evidenceCount = finding.evidenceIds?.length || 0;
  const allowedTargets: Array<'validated' | 'rejected' | 'candidate'> =
    finding.state === 'candidate'
      ? ['validated', 'rejected']
      : finding.state === 'validated'
        ? ['rejected']
        : ['candidate'];
  const isValidationBlocked = targetState === 'validated' && evidenceCount === 0;
  const isRejectMissingReason = targetState === 'rejected' && !reason.trim();
  const isSubmitDisabled =
    isSubmitting || isValidationBlocked || isRejectMissingReason || !allowedTargets.includes(targetState);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const updated = await fetchJson<Finding>(`/findings/${finding.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: targetState,
          reason: reason.trim() || undefined,
          evidenceIds: finding.evidenceIds,
        }),
      });

      onTransitionSuccess(updated);
      onClose();
    } catch (err) {
      setErrorMessage(
        isApiError(err)
          ? err.message
          : 'Transition request failed. Check requirements and try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 font-sans select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transition-modal-title"
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-text">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-surface-2/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg border bg-accent/15 border-accent/30 text-accent">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 id="transition-modal-title" className="text-sm font-semibold text-text">
                Transition Finding State
              </h3>
              <p className="text-[11px] text-text-muted font-mono">{finding.id}</p>
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
          {/* Target Finding Info */}
          <div className="p-3 bg-bg rounded-lg border border-border space-y-1">
            <span className="text-[10px] text-text-muted uppercase font-mono">Finding</span>
            <p className="font-semibold text-text text-xs line-clamp-1">{finding.title}</p>
            <div className="flex items-center gap-2 text-[11px] font-mono text-text-muted">
              <span>Current: <strong className="text-text uppercase">{finding.state}</strong></span>
              <span>&bull;</span>
              <span>Evidence: <strong className="text-text">{evidenceCount}</strong></span>
            </div>
          </div>

          {/* Visible Error Banner */}
          {errorMessage && (
            <div className="bg-danger/15 border border-danger/30 rounded-lg p-2.5 flex items-start gap-2 text-danger font-mono text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Transition Refused</p>
                <p className="text-[11px] text-danger/80 pt-0.5 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Target State Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text">Target State</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTargetState('validated')}
                disabled={!allowedTargets.includes('validated')}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-medium flex flex-col items-center gap-1 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  targetState === 'validated'
                    ? 'bg-success/15 border-success/40 text-success'
                    : 'bg-bg border-border text-text-muted hover:text-text'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Validated</span>
              </button>

              <button
                type="button"
                onClick={() => setTargetState('rejected')}
                disabled={!allowedTargets.includes('rejected')}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-medium flex flex-col items-center gap-1 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  targetState === 'rejected'
                    ? 'bg-danger/15 border-danger/40 text-danger'
                    : 'bg-bg border-border text-text-muted hover:text-text'
                }`}
              >
                <ShieldX className="w-4 h-4" />
                <span>Rejected</span>
              </button>

              <button
                type="button"
                onClick={() => setTargetState('candidate')}
                disabled={!allowedTargets.includes('candidate')}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-medium flex flex-col items-center gap-1 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
                  targetState === 'candidate'
                    ? 'bg-warning/15 border-warning/40 text-warning'
                    : 'bg-bg border-border text-text-muted hover:text-text'
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                <span>Candidate</span>
              </button>
            </div>
          </div>

          {/* Validation Blocked Warning */}
          {isValidationBlocked && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Validation Governance Blocked</span>
              </div>
              <p className="text-[11px] leading-relaxed text-danger/90">
                A candidate finding strictly requires at least one recorded evidence artifact before it can be validated. Attach wire evidence via Workbench first.
              </p>
            </div>
          )}

          {/* Transition Rationale Input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text">
                Transition Rationale {targetState === 'rejected' && <span className="text-danger">*</span>}
              </label>
              {targetState === 'rejected' && (
                <span className="text-[10px] text-danger font-mono font-semibold">Mandatory for Reject</span>
              )}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={
                targetState === 'rejected'
                  ? 'Required: Explain why this observation is false positive, out of scope, or non-exploitable...'
                  : 'Optional: Document reviewer justification or audit notes for this state change...'
              }
              className="w-full bg-bg border border-border rounded-lg p-2.5 text-xs text-text placeholder:text-text-muted/60 focus:outline-none focus:border-accent font-sans"
            />
          </div>

          {/* Footer */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 text-xs font-medium text-text transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Submitting...' : 'Apply Transition'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
