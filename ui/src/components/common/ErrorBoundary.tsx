import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  requestId: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    requestId: 'req_err_' + Math.random().toString(36).substring(2, 9),
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-bg text-text flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full rounded-lg border border-danger/40 bg-surface p-6 space-y-4 text-center">
            <AlertOctagon className="w-12 h-12 text-danger mx-auto" />
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-text">Application Rendering Error</h1>
              <p className="text-xs text-text-muted">
                {this.state.error?.message || 'An unexpected runtime error occurred while rendering the interface.'}
              </p>
            </div>

            <div className="p-2.5 rounded bg-bg border border-border font-mono text-[11px] text-left text-text-muted space-y-1">
              <div>Request ID: <strong className="text-text font-normal">{this.state.requestId}</strong></div>
              <div>Stack: <span className="text-[10px] text-text-muted/70 block truncate">{this.state.error?.stack}</span></div>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-accent text-[#0D1015] font-medium text-xs hover:bg-accent-hover transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
