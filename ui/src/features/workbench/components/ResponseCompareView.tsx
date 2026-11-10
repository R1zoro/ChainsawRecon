import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompare, ArrowRight } from 'lucide-react';
import { CapturedRequest, ResponseCompareResponse } from '../../../api/types';
import { fetchJson } from '../../../api/client';

interface ResponseCompareViewProps {
  requests: CapturedRequest[];
  initialBaselineId?: string;
  initialCandidateId?: string;
}

export const ResponseCompareView: React.FC<ResponseCompareViewProps> = ({
  requests,
  initialBaselineId,
  initialCandidateId,
}) => {
  const [baselineId, setBaselineId] = useState<string>(
    initialBaselineId || (requests.length > 0 ? requests[0].id : '')
  );
  const [candidateId, setCandidateId] = useState<string>(
    initialCandidateId || (requests.length > 1 ? requests[1].id : requests[0]?.id || '')
  );

  useEffect(() => {
    if (!baselineId && requests.length > 0) {
      setBaselineId(requests[0].id);
    }
    if (!candidateId && requests.length > 1) {
      setCandidateId(requests[1].id);
    }
  }, [requests, baselineId, candidateId]);

  const { data: compareResult, isLoading } = useQuery({
    queryKey: ['workbenchCompare', baselineId, candidateId],
    queryFn: () =>
      fetchJson<ResponseCompareResponse>('/workbench/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baselineId, candidateId }),
      }),
    enabled: Boolean(baselineId && candidateId),
  });

  const baselineReq = requests.find((r) => r.id === baselineId);
  const candidateReq = requests.find((r) => r.id === candidateId);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface select-none font-sans overflow-hidden text-xs">
      {/* Top Selector Bar */}
      <div className="p-3 border-b border-border bg-surface-2/30 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Baseline Selector */}
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-text-muted">Baseline:</span>
            <select
              value={baselineId}
              onChange={(e) => setBaselineId(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent"
            >
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}: {r.method} {r.path} [{r.status}]
                </option>
              ))}
            </select>
          </div>

          <ArrowRight className="w-4 h-4 text-text-muted" />

          {/* Candidate Selector */}
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <span className="text-text-muted">Candidate:</span>
            <select
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              className="bg-bg border border-border rounded px-2 py-1 text-text focus:outline-none focus:border-accent"
            >
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}: {r.method} {r.path} [{r.status}]
                </option>
              ))}
            </select>
          </div>
        </div>

        {compareResult && (
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded font-mono font-bold text-xs border ${
                compareResult.statusChanged
                  ? 'bg-warning/15 text-warning border-warning/30'
                  : 'bg-success/15 text-success border-success/30'
              }`}
            >
              {compareResult.statusChanged ? 'Status Changed' : 'Status Identical'}
            </span>
          </div>
        )}
      </div>

      {/* Comparison Summary Banner */}
      {compareResult && (
        <div className="bg-bg border-b border-border p-3 flex items-start gap-2 text-xs font-mono text-text">
          <GitCompare className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-text-muted">Status Diff:</span>
              <span className="text-accent">{baselineReq?.status}</span>
              <span className="text-text-muted">&rarr;</span>
              <span className="text-accent font-bold">{candidateReq?.status}</span>
            </div>
            <p className="text-text-muted text-[11px] pt-1 font-sans">{compareResult.summary}</p>
          </div>
        </div>
      )}

      {/* Main Diff Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden divide-x divide-border">
        {/* Headers Diff Panel */}
        <div className="w-1/3 flex flex-col min-h-0 bg-surface">
          <div className="p-2 border-b border-border bg-surface-2/40 font-mono text-[11px] text-text-muted font-semibold uppercase">
            Headers Differential
          </div>
          <div className="flex-1 overflow-auto p-3 font-mono text-xs space-y-1">
            {isLoading ? (
              <p className="text-text-muted italic">Computing header diff...</p>
            ) : compareResult?.headersDiff.map((line, idx) => (
              <div
                key={idx}
                className={`px-1.5 py-0.5 rounded leading-tight text-[11px] ${
                  line.type === 'added'
                    ? 'bg-success/15 text-success'
                    : line.type === 'removed'
                    ? 'bg-danger/15 text-danger'
                    : 'text-text-muted'
                }`}
              >
                {line.content}
              </div>
            ))}
          </div>
        </div>

        {/* Body Diff Panel */}
        <div className="flex-1 flex flex-col min-h-0 bg-surface">
          <div className="p-2 border-b border-border bg-surface-2/40 font-mono text-[11px] text-text-muted font-semibold uppercase">
            Body Line Differential
          </div>
          <div className="flex-1 overflow-auto p-3 font-mono text-xs space-y-1">
            {isLoading ? (
              <p className="text-text-muted italic">Computing body diff...</p>
            ) : compareResult?.bodyDiff.map((line, idx) => (
              <div
                key={idx}
                className={`px-2 py-0.5 rounded leading-relaxed whitespace-pre-wrap break-all ${
                  line.type === 'added'
                    ? 'bg-success/15 text-success'
                    : line.type === 'removed'
                    ? 'bg-danger/15 text-danger'
                    : 'text-text'
                }`}
              >
                {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                {line.content}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
