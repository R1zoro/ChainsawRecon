import React, { useState } from 'react';
import { Send, BookmarkPlus, GitCompare, Columns, Rows } from 'lucide-react';
import { CapturedRequest, RequestDetailResponse } from '../../../api/types';
import { RequestPane } from './RequestPane';
import { ResponsePane } from './ResponsePane';

interface RequestResponseSplitViewerProps {
  request: CapturedRequest;
  detail?: RequestDetailResponse | null;
  onSendToRepeater: (req: CapturedRequest) => void;
  onSaveEvidence: (req: CapturedRequest) => void;
  onCompareWithBaseline: (req: CapturedRequest) => void;
}

export const RequestResponseSplitViewer: React.FC<RequestResponseSplitViewerProps> = ({
  request,
  detail,
  onSendToRepeater,
  onSaveEvidence,
  onCompareWithBaseline,
}) => {
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface border-l border-border select-none font-sans overflow-hidden">
      {/* Top Controls Bar */}
      <div className="px-4 py-1.5 border-b border-border bg-bg/60 flex items-center justify-between text-xs font-mono shrink-0">
        <span className="text-text-muted">
          Inspector: <strong className="text-text">{request.id}</strong>
        </span>

        {/* Orientation Toggle */}
        <div className="flex items-center gap-1 bg-surface p-0.5 rounded border border-border">
          <button
            onClick={() => setOrientation('horizontal')}
            className={`p-1 rounded text-xs transition-colors ${
              orientation === 'horizontal' ? 'bg-surface-2 text-accent' : 'text-text-muted hover:text-text'
            }`}
            title="Split side-by-side"
          >
            <Columns className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setOrientation('vertical')}
            className={`p-1 rounded text-xs transition-colors ${
              orientation === 'vertical' ? 'bg-surface-2 text-accent' : 'text-text-muted hover:text-text'
            }`}
            title="Split stacked"
          >
            <Rows className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Split Panes */}
      <div className={`flex-1 flex min-h-0 overflow-hidden ${orientation === 'horizontal' ? 'flex-row' : 'flex-col divide-y divide-border'}`}>
        <RequestPane request={request} detail={detail} />
        <ResponsePane request={request} detail={detail} />
      </div>

      {/* Bottom Action Footer */}
      <div className="p-3 border-t border-border bg-surface-2/40 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSendToRepeater(request)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] font-semibold text-xs hover:bg-accent-hover transition-colors shadow-sm"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send to Repeater</span>
          </button>

          <button
            onClick={() => onSaveEvidence(request)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
          >
            <BookmarkPlus className="w-3.5 h-3.5 text-text-muted" />
            <span>Save as Evidence</span>
          </button>
        </div>

        <button
          onClick={() => onCompareWithBaseline(request)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-xs text-text transition-colors"
          title="Compare against another request"
        >
          <GitCompare className="w-3.5 h-3.5 text-text-muted" />
          <span>Compare...</span>
        </button>
      </div>
    </div>
  );
};
