import React, { useState, useMemo } from 'react';
import { Send, Plus, Trash2, GitCompare, Code, List, FileText } from 'lucide-react';
import { CapturedRequest } from '../../../api/types';

export interface EditableRequest {
  id: string;
  baselineId: string;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  queryParams: Array<{ key: string; value: string }>;
  body: string;
}

interface RepeaterRequestEditorProps {
  request: EditableRequest;
  baselineRequest?: CapturedRequest | null;
  onChange: (updated: EditableRequest) => void;
  onSend: () => void;
  isSending?: boolean;
}

export const RepeaterRequestEditor: React.FC<RepeaterRequestEditorProps> = ({
  request,
  baselineRequest,
  onChange,
  onSend,
  isSending = false,
}) => {
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body' | 'diff'>('params');

  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

  // Handle URL change
  const handleUrlChange = (newUrl: string) => {
    onChange({ ...request, url: newUrl });
  };

  // Query Params mutations
  const handleAddParam = () => {
    const updated = [...request.queryParams, { key: '', value: '' }];
    onChange({ ...request, queryParams: updated });
  };

  const handleUpdateParam = (index: number, key: string, value: string) => {
    const updated = [...request.queryParams];
    updated[index] = { key, value };
    onChange({ ...request, queryParams: updated });
  };

  const handleRemoveParam = (index: number) => {
    const updated = request.queryParams.filter((_, i) => i !== index);
    onChange({ ...request, queryParams: updated });
  };

  // Headers mutations
  const handleAddHeader = () => {
    const updated = [...request.headers, { key: '', value: '' }];
    onChange({ ...request, headers: updated });
  };

  const handleUpdateHeader = (index: number, key: string, value: string) => {
    const updated = [...request.headers];
    updated[index] = { key, value };
    onChange({ ...request, headers: updated });
  };

  const handleRemoveHeader = (index: number) => {
    const updated = request.headers.filter((_, i) => i !== index);
    onChange({ ...request, headers: updated });
  };

  // Body mutations
  const handleBodyChange = (newBody: string) => {
    onChange({ ...request, body: newBody });
  };

  // Diff vs Baseline computation
  const diffLines = useMemo(() => {
    const lines: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> = [];

    // Method comparison
    if (baselineRequest && baselineRequest.method !== request.method) {
      lines.push({ type: 'removed', text: `Method: ${baselineRequest.method}` });
      lines.push({ type: 'added', text: `Method: ${request.method}` });
    } else {
      lines.push({ type: 'unchanged', text: `Method: ${request.method}` });
    }

    // URL comparison
    if (baselineRequest && baselineRequest.url !== request.url) {
      lines.push({ type: 'removed', text: `URL: ${baselineRequest.url}` });
      lines.push({ type: 'added', text: `URL: ${request.url}` });
    } else {
      lines.push({ type: 'unchanged', text: `URL: ${request.url}` });
    }

    // Headers diff
    lines.push({ type: 'unchanged', text: '--- Headers ---' });
    request.headers.forEach((h) => {
      const origVal = baselineRequest?.requestHeaders[h.key];
      if (origVal === undefined) {
        lines.push({ type: 'added', text: `+ ${h.key}: ${h.value}` });
      } else if (origVal !== h.value) {
        lines.push({ type: 'removed', text: `- ${h.key}: ${origVal}` });
        lines.push({ type: 'added', text: `+ ${h.key}: ${h.value}` });
      } else {
        lines.push({ type: 'unchanged', text: `  ${h.key}: ${h.value}` });
      }
    });

    // Body diff
    if (baselineRequest?.requestBodyPreview || request.body) {
      lines.push({ type: 'unchanged', text: '--- Body ---' });
      if (baselineRequest?.requestBodyPreview !== request.body) {
        if (baselineRequest?.requestBodyPreview) {
          lines.push({ type: 'removed', text: `- ${baselineRequest.requestBodyPreview}` });
        }
        if (request.body) {
          lines.push({ type: 'added', text: `+ ${request.body}` });
        }
      } else {
        lines.push({ type: 'unchanged', text: `  ${request.body}` });
      }
    }

    return lines;
  }, [request, baselineRequest]);

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-surface border-r border-border font-sans select-none text-xs">
      {/* Top Header: Method, URL Bar & Send Action */}
      <div className="p-3 border-b border-border bg-surface-2/30 flex items-center gap-2">
        <select
          value={request.method}
          onChange={(e) => onChange({ ...request, method: e.target.value })}
          className="bg-bg border border-border rounded px-2 py-1 text-xs text-text font-mono font-bold focus:outline-none focus:border-accent uppercase shrink-0"
        >
          {methods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={request.url}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://api.example.com/api/v1/..."
          className="flex-1 bg-bg border border-border rounded px-2.5 py-1 text-xs text-text font-mono focus:outline-none focus:border-accent"
        />

        <button
          onClick={onSend}
          disabled={isSending}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm disabled:opacity-50 shrink-0"
        >
          <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-pulse' : ''}`} />
          <span>{isSending ? 'Sending...' : 'Send'}</span>
        </button>
      </div>

      {/* Tabs Row */}
      <div className="flex items-center justify-between border-b border-border px-3 bg-bg text-[11px] font-mono">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('params')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors ${
              activeTab === 'params'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <Code className="w-3 h-3" />
            <span>Params ({request.queryParams.length})</span>
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
            <span>Headers ({request.headers.length})</span>
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
            onClick={() => setActiveTab('diff')}
            className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors ${
              activeTab === 'diff'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            <GitCompare className="w-3 h-3" />
            <span>Diff vs Baseline</span>
          </button>
        </div>

        {activeTab === 'params' && (
          <button
            onClick={handleAddParam}
            className="flex items-center gap-1 text-[10px] text-accent hover:underline"
          >
            <Plus className="w-3 h-3" />
            <span>Add Param</span>
          </button>
        )}

        {activeTab === 'headers' && (
          <button
            onClick={handleAddHeader}
            className="flex items-center gap-1 text-[10px] text-accent hover:underline"
          >
            <Plus className="w-3 h-3" />
            <span>Add Header</span>
          </button>
        )}
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {activeTab === 'params' && (
          <div className="space-y-2">
            {request.queryParams.length === 0 ? (
              <div className="text-center py-6 text-text-muted italic">
                No query parameters. Click &quot;Add Param&quot; above to add one.
              </div>
            ) : (
              <div className="space-y-1.5">
                {request.queryParams.map((param, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={param.key}
                      onChange={(e) => handleUpdateParam(index, e.target.value, param.value)}
                      placeholder="key"
                      className="w-1/3 bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                    />
                    <input
                      type="text"
                      value={param.value}
                      onChange={(e) => handleUpdateParam(index, param.key, e.target.value)}
                      placeholder="value"
                      className="flex-1 bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => handleRemoveParam(index)}
                      className="p-1 rounded text-text-muted hover:text-danger hover:bg-surface-2 transition-colors"
                      title="Remove parameter"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'headers' && (
          <div className="space-y-2">
            {request.headers.length === 0 ? (
              <div className="text-center py-6 text-text-muted italic">
                No headers. Click &quot;Add Header&quot; above to add one.
              </div>
            ) : (
              <div className="space-y-1.5">
                {request.headers.map((header, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={header.key}
                      onChange={(e) => handleUpdateHeader(index, e.target.value, header.value)}
                      placeholder="Header-Name"
                      className="w-1/3 bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                    />
                    <input
                      type="text"
                      value={header.value}
                      onChange={(e) => handleUpdateHeader(index, header.key, e.target.value)}
                      placeholder="Header Value"
                      className="flex-1 bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
                    />
                    <button
                      onClick={() => handleRemoveHeader(index)}
                      className="p-1 rounded text-text-muted hover:text-danger hover:bg-surface-2 transition-colors"
                      title="Remove header"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'body' && (
          <div className="h-full flex flex-col">
            <textarea
              value={request.body}
              onChange={(e) => handleBodyChange(e.target.value)}
              placeholder="Enter JSON, raw body payload, or form data..."
              className="flex-1 w-full bg-bg border border-border rounded-lg p-3 text-xs text-text font-mono leading-relaxed focus:outline-none focus:border-accent resize-none"
            />
          </div>
        )}

        {activeTab === 'diff' && (
          <div className="h-full p-2 bg-bg rounded border border-border overflow-auto space-y-0.5">
            {diffLines.map((line, idx) => (
              <div
                key={idx}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono leading-tight ${
                  line.type === 'added'
                    ? 'bg-success/15 text-success'
                    : line.type === 'removed'
                    ? 'bg-danger/15 text-danger'
                    : 'text-text-muted'
                }`}
              >
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
