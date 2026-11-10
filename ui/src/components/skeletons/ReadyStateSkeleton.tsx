import React from 'react';

export const ReadyStateSkeleton: React.FC = () => {
  return (
    <div className="space-y-8 animate-pulse">
      {/* Resume Banner Skeleton */}
      <div className="h-28 rounded-lg bg-surface border border-border/60 p-5 space-y-3">
        <div className="flex justify-between items-center">
          <div className="h-4 w-1/3 bg-surface-2 rounded"></div>
          <div className="h-8 w-24 bg-surface-2 rounded"></div>
        </div>
        <div className="h-3 w-1/2 bg-surface-2 rounded"></div>
      </div>

      {/* Engagements Section Skeleton */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="h-6 w-32 bg-surface-2 rounded"></div>
          <div className="flex gap-2">
            <div className="h-8 w-24 bg-surface-2 rounded"></div>
            <div className="h-8 w-24 bg-surface-2 rounded"></div>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 rounded-lg bg-surface border border-border/60 p-4 space-y-3">
              <div className="h-5 w-3/4 bg-surface-2 rounded"></div>
              <div className="h-3 w-full bg-surface-2 rounded"></div>
              <div className="h-8 w-full bg-surface-2 rounded mt-6"></div>
            </div>
          ))}
        </div>
      </div>

      {/* Activity & Environment Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-40 rounded-lg bg-surface border border-border/60 p-4 space-y-2">
          <div className="h-4 w-28 bg-surface-2 rounded mb-3"></div>
          <div className="h-3 w-full bg-surface-2 rounded"></div>
          <div className="h-3 w-5/6 bg-surface-2 rounded"></div>
        </div>
        <div className="h-40 rounded-lg bg-surface border border-border/60 p-4 space-y-2">
          <div className="h-4 w-28 bg-surface-2 rounded mb-3"></div>
          <div className="h-3 w-full bg-surface-2 rounded"></div>
          <div className="h-3 w-5/6 bg-surface-2 rounded"></div>
        </div>
      </div>
    </div>
  );
};
