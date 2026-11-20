import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, RotateCw, Download, AlertTriangle, AlertCircle, 
  Check, Copy, FolderDown, Clock, CheckCircle2 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { 
  SessionReport, 
  SaveSessionReportResponse, 
  SavedReportItem, 
  Paginated,
  ReportExportFormat,
  ReportExportResponse
} from '../../api/types';

interface ReportsTabProps {
  sessionId: string;
  projectId: string;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  sessionId,
  projectId: _projectId,
}) => {
  const queryClient = useQueryClient();

  const [includeCandidates, setIncludeCandidates] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [copiedArtifactPath, setCopiedArtifactPath] = useState(false);
  const [lastSavedArtifact, setLastSavedArtifact] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<ReportExportFormat | null>(null);

  // 1. Fetch Report Preview
  const {
    data: report,
    isLoading: isReportLoading,
    error: reportError,
    refetch: refetchReport,
    isFetching: isReportFetching,
  } = useQuery({
    queryKey: ['sessionReport', sessionId, includeCandidates],
    queryFn: () =>
      fetchJson<SessionReport>(
        `/sessions/${sessionId}/report?includeCandidates=${includeCandidates}`
      ),
    enabled: Boolean(sessionId),
  });

  // 2. Fetch Saved Reports List
  const {
    data: savedReportsData,
    refetch: refetchSavedReports,
  } = useQuery({
    queryKey: ['sessionSavedReports', sessionId],
    queryFn: () =>
      fetchJson<Paginated<SavedReportItem>>(`/sessions/${sessionId}/reports`),
    enabled: Boolean(sessionId),
  });

  // 3. Save Report Mutation
  const saveReportMutation = useMutation({
    mutationFn: () =>
      fetchJson<SaveSessionReportResponse>(
        `/sessions/${sessionId}/reports?includeCandidates=${includeCandidates}`,
        { method: 'POST' }
      ),
    onSuccess: (data) => {
      setLastSavedArtifact(data.artifactId);
      queryClient.invalidateQueries({ queryKey: ['sessionSavedReports', sessionId] });
    },
  });

  const handleCopyMarkdown = () => {
    if (!report?.markdown) return;
    navigator.clipboard.writeText(report.markdown);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 2000);
  };

  const handleExport = async (format: ReportExportFormat) => {
    if (!report) return;
    setIsExporting(format);
    try {
      const res = await fetchJson<ReportExportResponse>(
        `/sessions/${sessionId}/report/export?format=${format}&includeCandidates=${includeCandidates}`
      );
      const extension = format === 'markdown' ? 'md' : format;
      const mimeType =
        format === 'json'
          ? 'application/json;charset=utf-8;'
          : format === 'html'
            ? 'text/html;charset=utf-8;'
            : 'text/markdown;charset=utf-8;';
      const blob = new Blob([res.content], { type: mimeType });
      if (typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function') {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `security-assessment-${sessionId}.${extension}`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL?.(url);
      }
    } catch (err) {
      console.error(`Failed to export ${format} report:`, err);
    } finally {
      setIsExporting(null);
    }
  };

  const handleDownloadSavedReport = async (filename: string) => {
    try {
      const res = await fetchJson<{ content?: string; filename?: string } | string>(
        `/sessions/${sessionId}/reports/${filename}`
      );
      const text = typeof res === 'string' ? res : res?.content || report?.markdown || '';
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
      if (typeof window !== 'undefined' && typeof window.URL?.createObjectURL === 'function') {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL?.(url);
      }
    } catch (err) {
      console.error('Failed to download saved report:', err);
    }
  };

  const coverageGapsCount = report?.coverage?.gaps?.length ?? 0;
  const validatedFindingsCount = report?.findings?.filter((f) => f.state === 'validated').length ?? 0;
  const candidateFindingsCount = report?.findings?.filter((f) => f.state === 'candidate').length ?? 0;
  const savedReports = savedReportsData?.items || [];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg overflow-hidden font-sans select-none">
      {/* Top Controls Header */}
      <div className="px-5 py-3 border-b border-border bg-surface flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Left: Title & Candidates Toggle */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-accent/15 text-accent border border-accent/20">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">Session Assessment Report</h2>
              <p className="text-[11px] text-text-muted">Evidence-backed security deliverables</p>
            </div>
          </div>

          {/* Include Candidates Toggle */}
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={includeCandidates}
                onChange={(e) => setIncludeCandidates(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-surface-2 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text after:border-border after:border after:rounded-full after:h-3 after:w-3.5 after:transition-all peer-checked:bg-warning"></div>
            </label>
            <span className="text-xs text-text font-medium">
              Include candidate findings
            </span>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetchReport()}
            disabled={isReportFetching}
            className="p-1.5 rounded-md border border-border hover:bg-surface-2 text-text-muted hover:text-text transition-colors"
            title="Refresh preview"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isReportFetching ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleCopyMarkdown}
            disabled={!report?.markdown}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-text hover:bg-surface-2 transition-colors disabled:opacity-50"
            title="Copy report markdown to clipboard"
          >
            {copiedMarkdown ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedMarkdown ? 'Copied' : 'Copy MD'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('markdown')}
            disabled={!report?.markdown || isExporting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-text hover:bg-surface-2 transition-colors disabled:opacity-50"
            title="Export Markdown file"
          >
            <Download className="w-3.5 h-3.5 text-accent" />
            <span>{isExporting === 'markdown' ? 'Exporting...' : 'Export MD'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('html')}
            disabled={!report?.markdown || isExporting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-text hover:bg-surface-2 transition-colors disabled:opacity-50"
            title="Export HTML file"
          >
            <Download className="w-3.5 h-3.5 text-accent" />
            <span>{isExporting === 'html' ? 'Exporting...' : 'Export HTML'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExport('json')}
            disabled={!report?.markdown || isExporting !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-text hover:bg-surface-2 transition-colors disabled:opacity-50"
            title="Export JSON file"
          >
            <Download className="w-3.5 h-3.5 text-accent" />
            <span>{isExporting === 'json' ? 'Exporting...' : 'Export JSON'}</span>
          </button>

          <button
            onClick={() => saveReportMutation.mutate()}
            disabled={saveReportMutation.isPending || isReportLoading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors disabled:opacity-50 shadow-sm"
          >
            <FolderDown className="w-3.5 h-3.5" />
            <span>{saveReportMutation.isPending ? 'Saving...' : 'Save Report'}</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-5 space-y-4">
        {/* Warning 1: Candidate findings toggle is active */}
        {includeCandidates && (
          <div className="p-3.5 rounded-xl bg-warning/10 border border-warning/30 text-warning text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Warning: Candidate findings included</span>
              <p className="text-text-muted mt-0.5 leading-relaxed">
                Candidate findings are unverified hypotheses. Including them in deliverables may present unvalidated attack vectors or false positives to stakeholders.
              </p>
            </div>
          </div>
        )}

        {/* Warning 2: Coverage Gaps Exist */}
        {coverageGapsCount > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div>
              <span className="font-semibold block">
                Absence of findings is not proof of clean scope ({coverageGapsCount} coverage gaps detected)
              </span>
              <p className="text-text-muted mt-0.5 leading-relaxed">
                The application model contains untested attack surfaces and unexamined input boundaries. Further verification is required before scope can be certified clean.
              </p>
            </div>
          </div>
        )}

        {/* Saved Artifact Banner */}
        {lastSavedArtifact && (
          <div className="p-3 rounded-lg bg-success/10 border border-success/30 text-success text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Artifact saved: <strong className="font-mono text-text">{lastSavedArtifact}</strong></span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(lastSavedArtifact);
                setCopiedArtifactPath(true);
                setTimeout(() => setCopiedArtifactPath(false), 2000);
              }}
              className="p-1 hover:bg-success/20 rounded text-success transition-colors"
              title="Copy artifact path"
            >
              {copiedArtifactPath ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {/* Metrics Banner */}
        {report && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-surface border border-border">
              <span className="text-[10px] font-mono uppercase text-text-muted block">Generated At</span>
              <span className="text-xs font-mono font-medium text-text mt-0.5 block truncate">
                {new Date(report.generatedAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-surface border border-border">
              <span className="text-[10px] font-mono uppercase text-text-muted block">Validated Findings</span>
              <span className="text-xs font-mono font-semibold text-success mt-0.5 block">
                {validatedFindingsCount}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-surface border border-border">
              <span className="text-[10px] font-mono uppercase text-text-muted block">Candidate Findings</span>
              <span className="text-xs font-mono font-semibold text-warning mt-0.5 block">
                {candidateFindingsCount}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-surface border border-border">
              <span className="text-[10px] font-mono uppercase text-text-muted block">Coverage Entries</span>
              <span className="text-xs font-mono font-medium text-text mt-0.5 block">
                {report.coverage?.entries ?? 0}
              </span>
            </div>
          </div>
        )}

        {/* Loading Preview */}
        {isReportLoading && (
          <div className="p-8 rounded-xl bg-surface border border-border flex flex-col items-center justify-center space-y-3 animate-pulse">
            <RotateCw className="w-6 h-6 text-accent animate-spin" />
            <p className="text-xs text-text-muted font-mono">Generating report preview from session projection...</p>
          </div>
        )}

        {/* Error State */}
        {reportError && (
          <div className="p-4 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs space-y-2">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to generate report</span>
            </div>
            <p className="text-text-muted">
              {isApiError(reportError) ? reportError.message : reportError instanceof Error ? reportError.message : 'Unknown error'}
            </p>
          </div>
        )}

        {/* Report Preview Display (Safe Markdown Viewer without dangerouslySetInnerHTML) */}
        {!isReportLoading && !reportError && report?.markdown && (
          <div className="rounded-xl bg-surface border border-border overflow-hidden shadow-sm flex flex-col">
            <div className="px-4 py-2.5 bg-surface-2/60 border-b border-border flex items-center justify-between">
              <span className="text-xs font-mono text-text-muted flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-accent" />
                <span>Markdown Deliverable Preview</span>
              </span>
              <span className="text-[11px] font-mono text-text-muted">
                {report.findings?.length ?? 0} findings recorded
              </span>
            </div>

            <div className="p-6 overflow-x-auto bg-[#0A0D12]">
              <pre className="font-mono text-xs leading-relaxed text-text whitespace-pre-wrap select-text break-words font-normal">
                {report.markdown}
              </pre>
            </div>
          </div>
        )}

        {/* Saved Reports Drawer / History */}
        {savedReports.length > 0 && (
          <div className="rounded-xl bg-surface border border-border p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-xs font-semibold text-text flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-text-muted" />
                <span>Previously Saved Reports ({savedReports.length})</span>
              </span>
              <button
                onClick={() => refetchSavedReports()}
                className="text-[11px] text-text-muted hover:text-text font-mono transition-colors"
              >
                Refresh List
              </button>
            </div>

            <div className="space-y-2">
              {savedReports.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg bg-bg border border-border flex items-center justify-between text-xs"
                >
                  <div className="space-y-0.5">
                    <span className="font-mono text-text font-medium block">{item.name}</span>
                    <span className="text-[10px] text-text-muted font-mono">{item.artifactId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted font-mono">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownloadSavedReport(item.name)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-2/80 text-text hover:text-accent border border-border text-xs font-mono transition-colors"
                      title={`Download ${item.name}`}
                      aria-label={`Download ${item.name}`}
                    >
                      <Download className="w-3.5 h-3.5 text-accent" />
                      <span>Download</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(item.artifactId);
                        setCopiedArtifactPath(true);
                        setTimeout(() => setCopiedArtifactPath(false), 2000);
                      }}
                      className="p-1 hover:bg-surface-2 rounded text-text-muted hover:text-text transition-colors"
                      title="Copy artifact path"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
