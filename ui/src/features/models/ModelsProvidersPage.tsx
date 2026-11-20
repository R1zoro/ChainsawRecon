import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  ArrowLeft, Plus, Server, RotateCw, AlertCircle, 
  Info, Cpu 
} from 'lucide-react';
import { fetchJson, isApiError } from '../../api/client';
import { Paginated, ProviderItem } from '../../api/types';
import { ProviderCard } from './components/ProviderCard';

const AddProviderModal = React.lazy(() =>
  import('./components/AddProviderModal').then((m) => ({ default: m.AddProviderModal }))
);
const CalibrateModal = React.lazy(() =>
  import('./components/CalibrateModal').then((m) => ({ default: m.CalibrateModal }))
);

export const ModelsProvidersPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [calibratingProvider, setCalibratingProvider] = useState<ProviderItem | null>(null);

  // 1. Fetch Providers
  const { 
    data: providersData, 
    isLoading, 
    error, 
    refetch, 
    isFetching 
  } = useQuery({
    queryKey: ['providers'],
    queryFn: () => fetchJson<Paginated<ProviderItem>>('/providers'),
  });

  const providers = providersData?.items || [];

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans select-none selection:bg-accent/20 selection:text-accent">
      {/* Top Header */}
      <header className="border-b border-border bg-surface shrink-0 h-14 px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text transition-colors shrink-0"
            title="Return to Ready State"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 truncate">
            <span
              onClick={() => navigate('/')}
              className="text-text-muted text-xs cursor-pointer hover:text-text"
            >
              Ready State
            </span>
            <span className="text-text-muted/50 text-xs">/</span>
            <h1 className="text-sm font-semibold text-text tracking-tight truncate flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-accent" />
              <span>Models & Inference Providers</span>
            </h1>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg bg-surface-2 hover:bg-surface-2/80 border border-border text-text-muted hover:text-text transition-colors disabled:opacity-50"
            title="Refresh providers"
          >
            <RotateCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-accent' : ''}`} />
          </button>

          <button
            onClick={() => setIsAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors"
            title="Add a new provider or Web UI driver"
          >
            <Plus className="w-4 h-4" />
            <span>Add Provider</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
        {/* Architecture & Web UI Advisory Banner */}
        <div className="p-4 rounded-xl bg-surface border border-border flex items-start gap-3">
          <Info className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-xs text-text-muted font-sans leading-relaxed">
            <h3 className="font-semibold text-text">Inference Architecture & Browser Automation</h3>
            <p>
              Chainsaw supports local engines (Ollama), OpenAI-compatible gateways (vLLM, Groq), and persistent <strong>Web UI browser drivers</strong> (ChatGPT Web, DeepSeek Web).
            </p>
            <p>
              Web UI drivers launch a real Chromium browser window. The operator logs in once, and the profile is saved persistently in the designated directory. 
              Anti-bot challenges, CAPTCHAs, and 2FA are completed manually by the operator. Web UI automation does not require API keys and does not claim official API reliability.
            </p>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-lg bg-danger/10 border border-danger/30 text-danger space-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>Failed to load inference providers</span>
            </div>
            <p className="font-sans">{isApiError(error) ? error.message : 'Network error loading providers.'}</p>
            <button
              onClick={() => refetch()}
              className="px-3 py-1 rounded bg-danger/20 hover:bg-danger/30 border border-danger/40 text-danger text-xs font-mono"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-56 rounded-lg bg-surface border border-border p-5 space-y-3">
                <div className="h-4 bg-surface-2 rounded w-2/3" />
                <div className="h-16 bg-surface-2 rounded" />
                <div className="h-8 bg-surface-2 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && providers.length === 0 && (
          <div 
            data-testid="providers-empty-state"
            className="py-16 text-center border border-dashed border-border rounded-xl bg-surface/40 max-w-xl mx-auto space-y-4 p-8"
          >
            <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto text-accent">
              <Server className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-text">No Providers Configured</h3>
              <p className="text-xs text-text-muted leading-relaxed font-sans max-w-md mx-auto">
                Connect a local Ollama instance, an OpenAI-compatible endpoint, or add a Web UI driver to enable autonomous security execution.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => setIsAddOpen(true)}
                className="px-4 py-1.5 rounded-lg bg-accent text-[#0D1015] hover:bg-accent-hover font-medium text-xs transition-colors inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add First Provider</span>
              </button>
            </div>
          </div>
        )}

        {/* Provider Cards Grid */}
        {!isLoading && providers.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-text-muted font-mono">
              <span>Configured Providers ({providers.length})</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {providers.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onCalibrate={(prov) => setCalibratingProvider(prov)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <React.Suspense fallback={null}>
        {isAddOpen && (
          <AddProviderModal
            isOpen={isAddOpen}
            onClose={() => setIsAddOpen(false)}
            onProviderCreated={() => {
              queryClient.invalidateQueries({ queryKey: ['providers'] });
            }}
          />
        )}

        {calibratingProvider && (
          <CalibrateModal
            provider={calibratingProvider}
            isOpen={Boolean(calibratingProvider)}
            onClose={() => setCalibratingProvider(null)}
          />
        )}
      </React.Suspense>
    </div>
  );
};
