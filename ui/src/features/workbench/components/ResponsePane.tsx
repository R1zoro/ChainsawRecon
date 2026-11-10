import React, { useState, useMemo } from 'react';
import { Copy, Check, AlertTriangle, List, FileText, Eye } from 'lucide-react';
import { CapturedRequest, RequestDetailResponse } from '../../../api/types';
import { redactHeaders, isSensitiveHeader } from '../redaction';

interface ResponsePaneProps {
  request: CapturedRequest;
  detail?: RequestDetailResponse | null;
}

export const ResponsePane: React.FC<ResponsePaneProps> = ({ request, detail }) => {
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'raw'>('body');
  const [copiedBody, setCopiedBody] = useState(false);

  const safeHeaders = useMemo(() => {
    return redactHeaders(request.responseHeaders || {});
  }, [request.responseHeaders]);

  const formattedBody = useMemo(() => {
    if (!request.responseBodyPreview) return '';
    try {
      const parsed = JSON.parse(request.responseBodyPreview);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return request.responseBodyPreview;
    }
  }, [request.responseBodyPreview]);

  const handleCopyBody = () => {
    navigator.clipboard.writeText(formattedBody);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  const getStatusBadgeClass = (status: number) => {
    if (status >= 200 && status < 300) {
      return 'text-success bg-success/15 border-success/30';
    }
    if (status >= 300 && status < 400) {
      return 'text-accent bg-accent/15 border-accent/30';
    }
    if (status >= 400 && status < 500) {
      return 'text-warning bg-warning/15 border-warning/30';
    }
    if (status >= 500) {
      return 'text-danger bg-danger/15 border-danger/30';
    }
    return 'text-text-muted bg-surface-2 border-border';
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface font-sans select-none text-xs">
      {/* Top Header: Status Code, Duration, Size */}
      <div className="p-3 border-b border-border bg-surface-2/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${getStatusBadgeClass(request.status)}`}>
            {request.status} {request.status === 200 ? 'OK' : request.status === 403 ? 'Forbidden' : request.status === 204 ? 'No Content' : ''}
          </span>
          <span className="text-text-muted text-[11px] font-mono">
            {request.durationMs}ms
          </span>
          <span className="text-text-muted text-[11px] font-mono">
            &bull;
          </span>
          <span className="text-text-muted text-[11px] font-mono">
            {formatSize(request.sizeBytes)}
          </span>
        </div>

        {formattedBody && (
          <button
            onClick={handleCopyBody}
            className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text"
          >
            {copiedBody ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedBody ? 'Copied' : 'Copy Body'}</span>
          </button>
        )}
      </div>

      {/* Tabs Row */}
      <div className="flex items-center border-b border-border px-3 bg-bg text-[11px] font-mono">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('body')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors ${
              activeTab === 'body'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <FileText className="w-3 h-3" />
            <span>Body</span>
          </button>

          <button
            onClick={() => setActiveTab('headers')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors ${
              activeTab === 'headers'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <List className="w-3 h-3" />
            <span>Headers ({Object.keys(safeHeaders).length})</span>
          </button>

          <button
            onClick={() => setActiveTab('raw')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors ${
              activeTab === 'raw'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Raw HTTP</span>
          </button>
        </div>
      </div>

      {/* Truncation Warning Banner (if body is large / truncated) */}
      {detail?.truncated && (
        <div className="bg-warning/15 border-b border-warning/30 px-3 py-1.5 flex items-center gap-2 text-[11px] font-mono text-warning">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Body truncated (exceeds 64 KB preview threshold). Full artifact slice preserved.</span>
        </div>
      )}

      {/* Tab Contents */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {activeTab === 'body' && (
          <div className="h-full">
            {!formattedBody ? (
              <p className="text-text-muted text-xs italic">No response body received.</p>
            ) : (
              <pre className="p-3 bg-bg rounded border border-border overflow-auto text-xs font-mono text-text leading-relaxed whitespace-pre-wrap break-all">
                {formattedBody}
              </pre>
            )}
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="space-y-1">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-text-muted uppercase border-b border-border/60">
                <tr>
                  <th className="py-1 px-2 font-medium w-40">Header</th>
                  <th className="py-1 px-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {Object.entries(safeHeaders).map(([key, val]) => {
                  const isRedacted = isSensitiveHeader(key);
                  return (
                    <tr key={key} className="hover:bg-surface-2/40">
                      <td className="py-1.5 px-2 text-text-muted font-semibold">{key}:</td>
                      <td className="py-1.5 px-2 text-text break-all">
                        {isRedacted ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-warning/15 text-warning text-[10px] border border-warning/30">
                            {val}
                          </span>
                        ) : (
                          val
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="h-full">
            <pre className="p-3 bg-bg rounded border border-border overflow-auto text-xs font-mono text-text-muted leading-relaxed whitespace-pre-wrap break-all">
              {detail?.rawResponse || `HTTP/1.1 ${request.status} OK\r\n\r\n${request.responseBodyPreview}`}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
