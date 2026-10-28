/**
 * Overview Page — Storyline, Use Cases, and Supply Chain views.
 */

import { useState, useRef } from 'react';
import { SupplyChainEuropeMap, STOPS } from '../components/SupplyChainEuropeMap';
import { Storyline2View } from '../components/Storyline2View';
import { UseCasesView } from '../components/UseCasesView';

// ── Page Component ───────────────────────────────────────────────────

export function OverviewPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'usecases' | 'storyline' | 'globe'>('storyline');
  const [selectedStop, setSelectedStop] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b bg-background flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Overview</h1>
        <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('storyline')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'storyline'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Storyline
          </button>
          <button
            type="button"
            onClick={() => setViewMode('usecases')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'usecases'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Use Cases
          </button>
          <button
            type="button"
            onClick={() => setViewMode('globe')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === 'globe'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Supply Chain
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {viewMode === 'usecases' ? (
          <UseCasesView />
        ) : viewMode === 'storyline' ? (
          <Storyline2View />
        ) : (
          <div className="absolute inset-0">
            <SupplyChainEuropeMap highlightedStop={selectedStop} />
            <aside className="absolute top-6 left-8 z-10 w-56 rounded-xl border border-white/15 dark:border-white/15 border-slate-300 bg-white/80 dark:bg-slate-900/70 backdrop-blur-md shadow-xl overflow-hidden">
              <div className="flex flex-col">
                {STOPS.map((stop) => {
                  const isActive = selectedStop === stop.id;
                  return (
                    <button
                      key={stop.id}
                      type="button"
                      onClick={() => setSelectedStop(isActive ? null : stop.id)}
                      className={`flex items-center gap-2 px-3 py-2 text-left text-xs border-b border-slate-200 dark:border-white/10 last:border-b-0 transition-colors ${
                        isActive
                          ? 'bg-primary/20 dark:bg-primary/30 text-foreground dark:text-white'
                          : 'text-slate-700 dark:text-white/85 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: stop.color }}
                      />
                      <span className="truncate">{stop.label}</span>
                    </button>
                  );
                })}
              </div>
              {/* Large image preview when a stop is selected */}
              {selectedStop && (() => {
                const stop = STOPS.find((s) => s.id === selectedStop);
                if (!stop) return null;
                return (
                  <div className="border-t border-slate-200 dark:border-white/10 p-3">
                    <img
                      src={stop.image}
                      alt={stop.label}
                      className="w-full rounded-lg border border-slate-200 dark:border-white/15 shadow-sm"
                    />
                    <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-white">{stop.label}</p>
                    <p className="text-[11px] text-slate-500 dark:text-white/60">{stop.sub}</p>
                  </div>
                );
              })()}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
