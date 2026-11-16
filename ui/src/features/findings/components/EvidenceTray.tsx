import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileCode, Hash, Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import { EvidenceItem } from '../../../api/types';

interface EvidenceTrayProps {
  evidence: EvidenceItem[];
  evidenceIds: string[];
  projectId: string;
}

export const EvidenceTray: React.FC<EvidenceTrayProps> = ({
  evidence,
  evidenceIds,
  projectId,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyHash = (id: string, hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const hasLinkedEvidence = evidenceIds.length > 0;
  const hasResolvedEvidence = evidence.length > 0;

  return (
    <div className="space-y-3 font-sans">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted font-mono flex items-center gap-1.5">
          <FileCode className="w-3.5 h-3.5 text-accent" />
          <span>Recorded Evidence Tray ({evidence.length})</span>
        </h4>

        <Link
          to={`/projects/${projectId}/workbench`}
          className="flex items-center gap-1 text-[11px] font-mono text-accent hover:underline"
        >
          <span>Workbench</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {!hasLinkedEvidence ? (
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
          <div className="pt-1">
            <Link
              to={`/projects/${projectId}/workbench`}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-warning/20 hover:bg-warning/30 text-warning font-mono text-[11px] font-semibold transition-colors"
            >
              Capture HTTP Traffic in Workbench &rarr;
            </Link>
          </div>
        </div>
      ) : !hasResolvedEvidence ? (
        <div className="p-3.5 rounded-lg border border-border bg-surface-2 text-text-muted text-xs space-y-1">
          <p className="font-semibold text-text">Evidence metadata unavailable</p>
          <p className="text-[11px] leading-relaxed">
            This finding links {evidenceIds.length} evidence id(s), but no matching recorded artifact
            was returned. Treat the evidence as unresolved until the projection catches up.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {evidence.map((ev) => (
            <div
              key={ev.id}
              className="p-3 bg-bg rounded-lg border border-border space-y-2 font-mono text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-accent">{ev.id}</span>
                <span className="px-1.5 py-0.2 rounded bg-surface-2 text-[10px] text-text-muted border border-border uppercase">
                  {ev.kind}
                </span>
              </div>

              <p className="font-sans text-xs text-text">{ev.summary}</p>

              {/* Hash and Artifact Details */}
              <div className="flex items-center justify-between text-[11px] text-text-muted pt-1 border-t border-border/50">
                <div className="flex items-center gap-1.5 truncate max-w-[280px]">
                  <Hash className="w-3 h-3 text-text-muted shrink-0" />
                  <span className="truncate">{ev.hash}</span>
                </div>

                <button
                  onClick={() => handleCopyHash(ev.id, ev.hash || '')}
                  className="flex items-center gap-1 text-[11px] text-accent hover:underline shrink-0 ml-2"
                  title="Copy SHA-256 hash"
                >
                  {copiedId === ev.id ? (
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
              </div>
            </div>
          ))}

          {/* Any evidence IDs that didn't populate full object */}
          {evidence.length < evidenceIds.length && (
            <div className="p-2 bg-surface-2 rounded border border-border text-[11px] font-mono text-text-muted">
              Additional linked artifact IDs:{' '}
              {evidenceIds
                .filter((id) => !evidence.some((e) => e.id === id))
                .join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
