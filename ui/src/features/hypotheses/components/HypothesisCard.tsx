import React from 'react';
import { 
  HelpCircle, ArrowRight, Layers, FileCheck, History 
} from 'lucide-react';
import { Hypothesis } from '../../../api/types';

interface HypothesisCardProps {
  hypothesis: Hypothesis;
  projectId: string;
  onOpenTransition: (hypothesis: Hypothesis) => void;
  onNavigateFinding?: (findingId: string) => void;
}

export const HypothesisCard: React.FC<HypothesisCardProps> = ({
  hypothesis,
  projectId: _projectId,
  onOpenTransition,
  onNavigateFinding,
}) => {
  const getStateBadge = (state: string) => {
    switch (state) {
      case 'supported':
        return 'bg-success/15 text-success border-success/30';
      case 'suspected':
        return 'bg-warning/15 text-warning border-warning/30';
      case 'rejected':
        return 'bg-danger/15 text-danger border-danger/30';
      case 'blocked':
        return 'bg-danger/20 text-danger border-danger/40';
      case 'deferred':
      default:
        return 'bg-surface-2 text-text-muted border-border';
    }
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'validated':
        return 'bg-accent/20 text-accent border-accent/40';
      case 'high':
        return 'bg-success/15 text-success border-success/30';
      case 'medium':
        return 'bg-warning/15 text-warning border-warning/30';
      case 'low':
      case 'candidate':
      default:
        return 'bg-surface-2 text-text-muted border-border';
    }
  };

  const findings = hypothesis.linkedFindings || [];
  const evidence = hypothesis.linkedEvidence || [];

  return (
    <div className="p-4 rounded-xl bg-surface border border-border hover:border-border-focus transition-all space-y-3 font-sans shadow-sm">
      {/* Top Header: Title, State, Confidence */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase border ${getStateBadge(
                hypothesis.state
              )}`}
            >
              {hypothesis.state}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono border ${getConfidenceBadge(
                hypothesis.confidence
              )}`}
            >
              conf: {hypothesis.confidence}
            </span>
            {hypothesis.surface && (
              <span className="text-[11px] font-mono text-text-muted bg-bg px-1.5 py-0.5 rounded border border-border truncate max-w-[240px]">
                {hypothesis.surface}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-text tracking-tight">{hypothesis.title}</h3>
        </div>

        {/* Transition Action Button */}
        <button
          onClick={() => onOpenTransition(hypothesis)}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors shrink-0 font-medium"
          title="Transition hypothesis state"
        >
          <ArrowRight className="w-3.5 h-3.5 text-accent" />
          <span>Transition</span>
        </button>
      </div>

      {/* Security Question */}
      <div className="p-3 rounded-lg bg-bg border border-border/70 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
          <HelpCircle className="w-3.5 h-3.5 text-accent" />
          <span>Security Question</span>
        </div>
        <p className="text-xs text-text leading-relaxed italic">
          "{hypothesis.securityQuestion}"
        </p>
      </div>

      {/* Required Evidence Tags */}
      {hypothesis.requiredEvidence && hypothesis.requiredEvidence.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-mono text-text-muted block">Required Evidence</span>
          <div className="flex flex-wrap gap-1.5">
            {hypothesis.requiredEvidence.map((ev, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-2 border border-border text-[11px] font-mono text-text-muted"
              >
                <FileCheck className="w-3 h-3 text-accent" />
                <span>{ev}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Linked Findings & Evidence */}
      <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-text-muted">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5 text-warning" />
            <span>
              {findings.length > 0 ? (
                findings.map((fid) => (
                  <button
                    key={fid}
                    onClick={() => onNavigateFinding?.(fid)}
                    className="underline hover:text-text font-mono text-xs ml-1"
                  >
                    {fid}
                  </button>
                ))
              ) : (
                <span>0 findings</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <FileCheck className="w-3.5 h-3.5 text-accent" />
            <span>{evidence.length} evidence</span>
          </div>
        </div>

        {/* Transition History Count */}
        {hypothesis.reasons && hypothesis.reasons.length > 0 && (
          <div className="flex items-center gap-1 text-[11px] text-text-muted">
            <History className="w-3 h-3" />
            <span>{hypothesis.reasons.length} audit entry</span>
          </div>
        )}
      </div>
    </div>
  );
};
