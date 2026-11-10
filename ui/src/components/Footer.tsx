import React from 'react';
import { ShieldCheck, Book, Command, Star } from 'lucide-react';

interface FooterProps {
  onOpenShortcuts?: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onOpenShortcuts }) => {
  return (
    <footer className="border-t border-border/60 bg-bg text-[11px] font-mono text-text-muted mt-auto py-4">
      <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-2 border border-border text-text-muted text-[10px]">
            <ShieldCheck className="w-3 h-3 text-success" />
            Local-only execution
          </span>
          <span>ChainsawRecon v2.0.0-preview</span>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <a
            href="https://github.com/R1zoro/ChainsawRecon#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text flex items-center gap-1 transition-colors"
          >
            <Book className="w-3.5 h-3.5" />
            <span>Docs</span>
          </a>

          <button
            onClick={onOpenShortcuts}
            className="hover:text-text flex items-center gap-1 transition-colors"
          >
            <Command className="w-3.5 h-3.5" />
            <span>Shortcuts</span>
          </button>

          <a
            href="https://github.com/R1zoro/ChainsawRecon"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-warning flex items-center gap-1 transition-colors"
          >
            <Star className="w-3.5 h-3.5" />
            <span>Star</span>
          </a>
        </div>
      </div>
    </footer>
  );
};
