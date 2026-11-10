import React, { useState, useMemo } from 'react';
import { Copy, Check, Lock, Code, FileText, List, Eye } from 'lucide-react';
import { CapturedRequest, RequestDetailResponse } from '../../../api/types';
import { redactHeaders, parseQueryParams, isSensitiveHeader } from '../redaction';

interface RequestPaneProps {
  request: CapturedRequest;
  detail?: RequestDetailResponse | null;
}

export const RequestPane: React.FC<RequestPaneProps> = ({ request, detail }) => {
  const [activeTab, setActiveTab] = useState<'headers' | 'query' | 'body' | 'raw'>('headers');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  const safeHeaders = useMemo(() => {
    return redactHeaders(request.requestHeaders || {});
  }, [request.requestHeaders]);

  const queryParams = useMemo(() => {
    return parseQueryParams(request.url || request.path);
  }, [request.url, request.path]);

  const formattedBody = useMemo(() => {
    if (!request.requestBodyPreview) return '';
    try {
      const parsed = JSON.parse(request.requestBodyPreview);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return request.requestBodyPreview;
    }
  }, [request.requestBodyPreview]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(request.url || `${request.host}${request.path}`);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleCopyBody = () => {
    navigator.clipboard.writeText(formattedBody);
    setCopiedBody(true);
    setTimeout(() => setCopiedBody(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface border-r border-border font-sans select-none text-xs">
      {/* Top Header: Method, URL bar, Copy */}
      <div className="p-3 border-b border-border bg-surface-2/30 flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider text-accent border-accent/30 bg-accent/10 shrink-0 font-mono">
          {request.method}
        </span>
        <div className="flex-1 font-mono text-xs text-text truncate bg-bg px-2 py-1 rounded border border-border">
          {request.url || `${request.host}${request.path}`}
        </div>
        <button
          onClick={handleCopyUrl}
          className="p-1 rounded hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
          title="Copy URL"
        >
          {copiedUrl ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center justify-between border-b border-border px-3 bg-bg text-[11px] font-mono">
        <div className="flex items-center gap-1">
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
            onClick={() => setActiveTab('query')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors ${
              activeTab === 'query'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <Code className="w-3 h-3" />
            <span>Query ({queryParams.length})</span>
          </button>

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

        {activeTab === 'body' && formattedBody && (
          <button
            onClick={handleCopyBody}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text"
          >
            {copiedBody ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
            <span>{copiedBody ? 'Copied' : 'Copy Body'}</span>
          </button>
        )}
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
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
                            <Lock className="w-2.5 h-2.5" />
                            <span>{val}</span>
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

        {activeTab === 'query' && (
          <div>
            {queryParams.length === 0 ? (
              <p className="text-text-muted text-xs italic">No query parameters in this request.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] text-text-muted uppercase border-b border-border/60">
                  <tr>
                    <th className="py-1 px-2 font-medium w-36">Parameter</th>
                    <th className="py-1 px-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {queryParams.map((param, index) => (
                    <tr key={index} className="hover:bg-surface-2/40">
                      <td className="py-1.5 px-2 text-accent font-semibold">{param.key}</td>
                      <td className="py-1.5 px-2 text-text break-all">{param.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'body' && (
          <div className="h-full">
            {!formattedBody ? (
              <p className="text-text-muted text-xs italic">No request body payload.</p>
            ) : (
              <pre className="p-3 bg-bg rounded border border-border overflow-auto text-xs font-mono text-text leading-relaxed whitespace-pre-wrap break-all">
                {formattedBody}
              </pre>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="h-full">
            <pre className="p-3 bg-bg rounded border border-border overflow-auto text-xs font-mono text-text-muted leading-relaxed whitespace-pre-wrap break-all">
              {detail?.rawRequest || `${request.method} ${request.path} HTTP/1.1\r\nHost: ${request.host}\r\n\r\n${request.requestBodyPreview}`}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};
