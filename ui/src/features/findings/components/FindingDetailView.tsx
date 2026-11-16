import React, { useState } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  HelpCircle, 
  ShieldAlert, 
  Copy, 
  Check, 
  ArrowRightLeft, 
  GitBranch, 
  ListOrdered,
  FileQuestion,
  ShieldCheck,
  Calendar,
  ExternalLink
} from 'lucide-react';
import { Finding, EvidenceItem, FindingSeverity, FindingState } from '../../../api/types';
import { EvidenceTray } from './EvidenceTray';

interface FindingDetailViewProps {
  finding: Finding;
  evidence: EvidenceItem[];
  projectId: string;
  onOpenTransitionModal: () => void;
}

export const FindingDetailView: React.FC<FindingDetailViewProps> = ({
  finding,
  evidence,
  projectId,
  onOpenTransitionModal,
}) => {
  const [copiedJson, setCopiedJson] = useState(false);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(finding, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

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
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-semibold bg-success/15 border border-success/30 text-success">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Validated</span>
          </span>
        );
      case 'rejected':
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-semibold bg-danger/15 border border-danger/30 text-danger">
            <XCircle className="w-3.5 h-3.5" />
            <span>Rejected</span>
          </span>
        );
      case 'candidate':
      default:
        return (
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium bg-warning/10 border border-warning/30 text-warning">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Candidate</span>
          </span>
        );
    }
  };

  const gateQuestions = finding.gate?.questions ?? [];
  const hasGate = gateQuestions.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg overflow-y-auto select-none font-sans">
      {/* 1. Header & Summary Actions */}
      <div className="p-6 border-b border-border bg-surface space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-text-muted">{finding.id}</span>
              <span className="text-text-muted">&bull;</span>
              <span className="text-xs font-mono text-text-muted">{finding.vrt || 'unclassified'}</span>
            </div>
            <h2 className="text-lg font-bold text-text leading-tight">{finding.title}</h2>
            <div className="flex items-center gap-2 pt-1 font-mono text-xs text-text-muted truncate">
              <span className="text-text-muted uppercase text-[10px]">Asset:</span>
              <a
                href={finding.asset}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline flex items-center gap-1 truncate"
              >
                <span>{finding.asset}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyJson}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-bg hover:bg-surface-2 text-xs font-mono text-text transition-colors"
              title="Copy Finding JSON"
            >
              {copiedJson ? (
                <>
                  <Check className="w-3.5 h-3.5 text-success" />
                  <span className="text-success">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-text-muted" />
                  <span>JSON</span>
                </>
              )}
            </button>

            <button
              onClick={onOpenTransitionModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm"
              title="Request Finding State Transition"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transition State</span>
            </button>
          </div>
        </div>

        {/* Severity, State & Timestamps */}
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-mono border-t border-border/50">
          <span
            className={`px-2 py-0.5 rounded text-xs font-bold uppercase border tracking-wider ${getSeverityBadge(
              finding.severity
            )}`}
          >
            {finding.severity}
          </span>

          {getStateBadge(finding.state)}

          <div className="flex items-center gap-1.5 text-text-muted ml-auto text-[11px]">
            <Calendar className="w-3.5 h-3.5" />
            <span>Updated: {new Date(finding.updatedAt).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* 2. Main Content Grid */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Security Question, Reproduction, Impact, Gate */}
        <div className="lg:col-span-2 space-y-6">
          {/* Security Question */}
          <div className="p-4 bg-surface rounded-xl border border-border space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
              <FileQuestion className="w-4 h-4 text-accent" />
              <span>Security Question &amp; Hypothesis</span>
            </div>
            <p className={`text-xs leading-relaxed ${finding.securityQuestion ? 'text-text font-medium' : 'text-text-muted italic'}`}>
              {finding.securityQuestion || 'No security question recorded for this finding.'}
            </p>
          </div>

          {/* Reproduction Section */}
          <div className="p-4 bg-surface rounded-xl border border-border space-y-3 font-sans">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
              <ListOrdered className="w-4 h-4 text-accent" />
              <span>Reproduction Trace</span>
            </div>

            {Array.isArray(finding.reproduction) ? (
              <div className="space-y-2.5">
                {finding.reproduction.map((step) => (
                  <div
                    key={step.step}
                    className="p-3 bg-bg rounded-lg border border-border text-xs space-y-1.5 font-mono"
                  >
                    <div className="flex items-center gap-2 font-semibold text-text">
                      <span className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-[10px]">
                        {step.step}
                      </span>
                      <span>{step.description}</span>
                    </div>
                    {step.expected && (
                      <div className="text-[11px] text-text-muted pl-7">
                        Expected: <span className="text-text">{step.expected}</span>
                      </div>
                    )}
                    {step.actual && (
                      <div className="text-[11px] text-danger pl-7">
                        Actual: <span className="text-danger font-semibold">{step.actual}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-bg rounded-lg border border-border text-xs font-mono text-text whitespace-pre-wrap leading-relaxed">
                {typeof finding.reproduction === 'string' && finding.reproduction
                  ? finding.reproduction
                  : 'No reproduction steps recorded yet.'}
              </div>
            )}
          </div>

          {/* Impact & Remediation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-surface rounded-xl border border-border space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
                <ShieldAlert className="w-4 h-4 text-warning" />
                <span>Exploit Impact</span>
              </div>
              <p className={`text-xs leading-relaxed ${finding.impact ? 'text-text' : 'text-text-muted italic'}`}>
                {finding.impact || 'No impact assessment recorded yet.'}
              </p>
            </div>

            <div className="p-4 bg-surface rounded-xl border border-border space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
                <ShieldCheck className="w-4 h-4 text-success" />
                <span>Remediation Guidance</span>
              </div>
              <p className={`text-xs leading-relaxed ${finding.remediation ? 'text-text' : 'text-text-muted italic'}`}>
                {finding.remediation || 'No remediation guidance recorded yet.'}
              </p>
            </div>
          </div>

          {/* 7-Question Validation Gate */}
          <div className="p-4 bg-surface rounded-xl border border-border space-y-3 font-sans">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
                <HelpCircle className="w-4 h-4 text-accent" />
                <span>7-Question Validation Gate</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold border ${
                  !hasGate
                    ? 'bg-surface-2 border-border text-text-muted'
                    : finding.gate?.passed
                      ? 'bg-success/15 border-success/30 text-success'
                      : 'bg-warning/15 border-warning/30 text-warning'
                }`}
              >
                {!hasGate
                  ? 'Gate: Not recorded'
                  : finding.gate?.passed
                    ? 'Gate: Passed'
                    : 'Gate: Pending / Incomplete'}
              </span>
            </div>

            {!hasGate ? (
              <p className="text-xs text-text-muted italic p-2.5 bg-bg rounded-lg border border-border/80">
                No validation gate has been recorded for this finding. The backend owns gate results;
                this surface does not infer them.
              </p>
            ) : (
              <div className="space-y-2">
                {gateQuestions.map((q) => (
                  <div
                    key={q.id}
                    className="p-2.5 bg-bg rounded-lg border border-border/80 flex items-start gap-2.5 text-xs font-mono"
                  >
                    <div className="mt-0.5 shrink-0">
                      {q.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-success" />
                      ) : (
                        <XCircle className="w-4 h-4 text-warning" />
                      )}
                    </div>
                    <div className="flex-1 space-y-0.5">
                      <span className="font-semibold text-text">
                        Q{q.id}: {q.reason}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Evidence Tray & Lineage */}
        <div className="space-y-6">
          {/* Evidence Tray */}
          <div className="p-4 bg-surface rounded-xl border border-border">
            <EvidenceTray
              evidence={evidence}
              evidenceIds={finding.evidenceIds || []}
              projectId={projectId}
            />
          </div>

          {/* Lineage & Audit Trail */}
          <div className="p-4 bg-surface rounded-xl border border-border space-y-3 font-sans">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted font-mono">
              <GitBranch className="w-4 h-4 text-accent" />
              <span>Lineage &amp; Provenance</span>
            </div>

            <div className="p-3 bg-bg rounded-lg border border-border text-xs font-mono space-y-2">
              <div className="flex items-center justify-between text-text-muted">
                <span>Session:</span>
                <span className="text-text">{finding.sessionId}</span>
              </div>
              <div className="flex items-center justify-between text-text-muted">
                <span>Project:</span>
                <span className="text-text">{finding.projectId}</span>
              </div>
              {finding.lineage?.hypothesisId && (
                <div className="flex items-center justify-between text-text-muted">
                  <span>Hypothesis:</span>
                  <span className="text-text">{finding.lineage.hypothesisId}</span>
                </div>
              )}
              {finding.lineage?.taskId && (
                <div className="flex items-center justify-between text-text-muted">
                  <span>Origin Task:</span>
                  <span className="text-text">{finding.lineage.taskId}</span>
                </div>
              )}
              {finding.lineage?.discoveredBy && (
                <div className="flex items-center justify-between text-text-muted">
                  <span>Discovered By:</span>
                  <span className="text-text">{finding.lineage.discoveredBy}</span>
                </div>
              )}
              {finding.lineage?.validatedBy && (
                <div className="flex items-center justify-between text-success font-semibold border-t border-border pt-1.5">
                  <span>Validated By:</span>
                  <span>{finding.lineage.validatedBy}</span>
                </div>
              )}
              {finding.lineage?.validatedAt && (
                <div className="flex items-center justify-between text-text-muted">
                  <span>Validated At:</span>
                  <span>{new Date(finding.lineage.validatedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
