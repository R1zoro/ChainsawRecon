import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Construction } from 'lucide-react';
import { TopMenuBar } from '../TopMenuBar';
import { Footer } from '../Footer';

interface RoutePlaceholderProps {
  title: string;
  milestone: string;
  description: string;
}

export const RoutePlaceholder: React.FC<RoutePlaceholderProps> = ({
  title,
  milestone,
  description,
}) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col font-sans">
      <TopMenuBar />
      <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-12 flex flex-col items-center justify-center text-center space-y-4">
        <div className="p-4 rounded-full bg-surface-2 border border-border">
          <Construction className="w-8 h-8 text-accent" />
        </div>
        <div className="space-y-1">
          <span className="text-[11px] font-mono uppercase tracking-wider text-accent px-2 py-0.5 rounded bg-accent/10 border border-accent/30">
            {milestone}
          </span>
          <h1 className="text-xl font-semibold text-text pt-2">{title}</h1>
          <p className="text-xs text-text-muted max-w-md mx-auto">{description}</p>
        </div>

        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-surface-2 text-text hover:bg-surface-2/80 border border-border text-xs transition-colors mt-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to Ready State</span>
        </button>
      </main>
      <Footer />
    </div>
  );
};
