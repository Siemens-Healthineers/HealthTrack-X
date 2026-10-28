/**
 * SupplyChainEuropeMap — 2D Europe map (SVG) showing the HealthTrack-X supply chain.
 * Country outlines come from world-atlas TopoJSON, projected with d3-geo (Mercator).
 * Markers pulse and arcs animate between supply chain stops.
 */

import { useEffect, useMemo, useState } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { FeatureCollection, Feature, Geometry } from 'geojson';
import { useTheme } from '../contexts/ThemeContext';

// ── Theme palettes (dark = night-ocean style, light = soft daylight) ──
const DARK_PALETTE = {
  ocean: '#0b1a3a',
  grid: '#1e3a8a',
  countryFill: '#1e3a8a',
  countryFillOpacity: 0.35,
  countryStroke: '#22d3ee',
  countryStrokeOpacity: 0.55,
  subtitle: '#e2e8f0',
  textHalo: '#0b1a3a',
  loading: 'text-cyan-300/70',
};
const LIGHT_PALETTE = {
  ocean: '#e0f2fe',          // pale sky/water
  grid: '#94a3b8',
  countryFill: '#f8fafc',
  countryFillOpacity: 1,
  countryStroke: '#475569',
  countryStrokeOpacity: 0.65,
  subtitle: '#1e293b',
  textHalo: '#ffffff',
  loading: 'text-slate-500',
};

// ── Supply chain stops (lat, lon, label) ──────────────────────
interface Stop {
  id: string;
  label: string;
  sub: string;
  lat: number;
  lon: number;
  color: string;
  /** Direction (in degrees, 0 = right, 90 = down) for the label callout */
  labelDir: number;
  /** Path to thumbnail image shown next to the label */
  image: string;
}

const STOPS: Stop[] = [
  { id: 'raw',        label: '1. Raw Material',  sub: 'Aluminum (Norway)',     lat: 59.91, lon:  10.75, color: '#94a3b8', labelDir: -110, image: '/images/materials/Storyline-1.png' },
  { id: 'component',  label: '2. Component',     sub: 'Casting (Stalowa Wola, Poland)', lat: 50.58, lon:  22.05, color: '#fb923c', labelDir:   30, image: '/images/materials/Storyline-2.png' },
  { id: 'subasm',     label: '3. Subassembly',   sub: 'Milling (Kemnath)',     lat: 49.87, lon:  11.90, color: '#38bdf8', labelDir:   50, image: '/images/materials/Gantry-Milling.png' },
  { id: 'final',      label: '4. Final Product', sub: 'Assembly (Forchheim)',  lat: 49.72, lon:  11.06, color: '#22d3ee', labelDir:  140, image: '/images/materials/Storyline-4.png' },
  { id: 'use',        label: '5. Use Phase',     sub: 'Clinic (Spain)',        lat: 40.42, lon:  -3.70, color: '#a78bfa', labelDir:  200, image: '/images/materials/Storyline-5.png' },
  { id: 'eol',        label: '6. End of Life',   sub: 'Recycling (Hanau)',     lat: 50.13, lon:   8.92, color: '#34d399', labelDir: -150, image: '/images/materials/Storyline-6.png' },
];

const VIEWBOX_W = 1000;
const VIEWBOX_H = 700;

// ISO numeric codes for European countries (rough bounding region) — used to filter features
const EUROPE_ISO = new Set([
  '008','020','040','056','070','100','112','191','196','203',
  '208','233','246','250','276','300','348','352','372','380',
  '428','438','440','442','470','498','492','499','528','578',
  '616','620','642','643','674','688','703','705','724','752',
  '756','792','804','807','826','983',
]);

export { STOPS };

export interface SupplyChainEuropeMapProps {
  highlightedStop?: string | null;
}

// Module-level cache: world-atlas is bundled once, the filtered FeatureCollection
// is reused across mounts and theme toggles instead of re-fetched/re-parsed.
let europeFcCache: FeatureCollection | null = null;
async function loadEurope(): Promise<FeatureCollection> {
  if (europeFcCache) return europeFcCache;
  // 110m TopoJSON is ~108 kB raw / ~38 kB gzip — plenty of detail for a Europe overview
  // and lazy-loaded so it does not bloat the initial bundle.
  const mod = await import('world-atlas/countries-110m.json');
  const topo: any = (mod as any).default ?? mod;
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection;
  europeFcCache = {
    type: 'FeatureCollection',
    features: fc.features.filter((f: Feature) => EUROPE_ISO.has(String(f.id))),
  };
  return europeFcCache;
}

export function SupplyChainEuropeMap({ highlightedStop }: SupplyChainEuropeMapProps) {
  const [countries, setCountries] = useState<FeatureCollection | null>(europeFcCache);
  const { isDarkMode } = useTheme();
  const palette = isDarkMode ? DARK_PALETTE : LIGHT_PALETTE;

  useEffect(() => {
    if (countries) return;
    let cancelled = false;
    loadEurope()
      .then((fc) => { if (!cancelled) setCountries(fc); })
      .catch((err) => console.error('Failed to load Europe map', err));
    return () => { cancelled = true; };
  }, [countries]);

  // Mercator projection focused on Europe
  const projection = useMemo(
    () =>
      geoMercator()
        .center([10, 53])      // longitude, latitude — center of Europe
        .scale(900)            // zoom level
        .translate([VIEWBOX_W / 2, VIEWBOX_H / 2]),
    [],
  );

  const pathGen = useMemo(() => geoPath(projection), [projection]);

  // Project each stop to SVG coordinates
  const projectedStops = useMemo(
    () =>
      STOPS.map((s) => {
        const coords = projection([s.lon, s.lat]);
        return { ...s, x: coords?.[0] ?? 0, y: coords?.[1] ?? 0 };
      }),
    [projection],
  );

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: palette.ocean }}>
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
      >
        <defs>
          {/* Soft glow filter for markers */}
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Per-stop gradient could be added; using flat colors keeps SVG simple */}
          {/* Rounded-rect clip for stop thumbnails */}
          {STOPS.map((s) => (
            <clipPath key={`clip-${s.id}`} id={`clip-${s.id}`}>
              <rect width={48} height={48} rx={6} ry={6} />
            </clipPath>
          ))}
        </defs>

        {/* Background ocean */}
        <rect x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H} fill={palette.ocean} />

        {/* Subtle latitude/longitude grid */}
        <g stroke={palette.grid} strokeOpacity={0.25} strokeWidth={0.5} fill="none">
          {[-20, -10, 0, 10, 20, 30, 40].map((lon) => {
            const p1 = projection([lon, 35]);
            const p2 = projection([lon, 72]);
            return p1 && p2 ? (
              <line key={`lon-${lon}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />
            ) : null;
          })}
          {[35, 45, 55, 65, 72].map((lat) => {
            const p1 = projection([-25, lat]);
            const p2 = projection([45, lat]);
            return p1 && p2 ? (
              <line key={`lat-${lat}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} />
            ) : null;
          })}
        </g>

        {/* Country outlines */}
        {countries && (
          <g>
            {countries.features.map((f, i) => {
              const d = pathGen(f as Feature<Geometry>);
              if (!d) return null;
              return (
                <path
                  key={(f.id as string) || i}
                  d={d}
                  fill={palette.countryFill}
                  fillOpacity={palette.countryFillOpacity}
                  stroke={palette.countryStroke}
                  strokeOpacity={palette.countryStrokeOpacity}
                  strokeWidth={0.6}
                />
              );
            })}
          </g>
        )}

        {/* Arcs between stops */}
        <g fill="none" strokeWidth={1.6}>
          {projectedStops.slice(0, -1).map((from, i) => {
            const to = projectedStops[i + 1];
            // Quadratic bezier with control point offset perpendicular to the line
            const mx = (from.x + to.x) / 2;
            const my = (from.y + to.y) / 2;
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const len = Math.hypot(dx, dy);
            const nx = -dy / len;
            const ny = dx / len;
            const offset = Math.min(120, len * 0.35);
            const cx = mx + nx * offset;
            const cy = my + ny * offset;
            const pathD = `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
            const dashLen = 8;
            return (
              <g key={`arc-${from.id}-${to.id}`}>
                {/* Faint full path */}
                <path d={pathD} stroke={to.color} strokeOpacity={0.25} />
                {/* Animated dashed flow */}
                <path
                  d={pathD}
                  stroke={to.color}
                  strokeOpacity={0.95}
                  strokeDasharray={`${dashLen} ${dashLen * 1.5}`}
                  filter="url(#glow)"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to={-dashLen * 2.5}
                    dur={`${1.5 + i * 0.2}s`}
                    repeatCount="indefinite"
                  />
                </path>
              </g>
            );
          })}
        </g>

        {/* Markers with pulsing halos */}
        <g>
          {projectedStops.map((s) => {
            const isHighlighted = highlightedStop === s.id;
            const isDimmed = highlightedStop != null && highlightedStop !== s.id;
            const markerOpacity = isDimmed ? 0.3 : 1;
            return (
              <g key={s.id} transform={`translate(${s.x} ${s.y})`} opacity={markerOpacity} style={{ transition: 'opacity 0.3s' }}>
                {/* Pulsing halo */}
                <circle r={isHighlighted ? 8 : 6} fill={s.color} opacity={0.5}>
                  <animate
                    attributeName="r"
                    from={isHighlighted ? '8' : '6'}
                    to={isHighlighted ? '30' : '20'}
                    dur={isHighlighted ? '1.2s' : '2s'}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    from="0.6"
                    to="0"
                    dur={isHighlighted ? '1.2s' : '2s'}
                    repeatCount="indefinite"
                  />
                </circle>
                {/* Solid marker */}
                <circle r={isHighlighted ? 8 : 5} fill={s.color} stroke="#fff" strokeWidth={isHighlighted ? 2 : 1.2} filter="url(#glow)" />
              </g>
            );
          })}
        </g>

        {/* Labels OUTSIDE the markers, connected by callout lines */}
        <g>
          {projectedStops.map((s) => {
            const isHighlighted = highlightedStop === s.id;
            const isDimmed = highlightedStop != null && highlightedStop !== s.id;
            const labelOpacity = isDimmed ? 0.25 : 1;
            const angleRad = (s.labelDir * Math.PI) / 180;
            const dist = 70;
            const lx = s.x + Math.cos(angleRad) * dist;
            const ly = s.y + Math.sin(angleRad) * dist;
            // Anchor the text based on which side of the marker it sits
            const cosA = Math.cos(angleRad);
            const textAnchor = cosA > 0.2 ? 'start' : cosA < -0.2 ? 'end' : 'middle';
            const tx = lx + (cosA > 0.2 ? 6 : cosA < -0.2 ? -6 : 0);
            return (
              <g key={`label-${s.id}`} opacity={labelOpacity} style={{ transition: 'opacity 0.3s' }}>
                {/* Callout line marker → label */}
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={lx}
                  y2={ly}
                  stroke={s.color}
                  strokeOpacity={0.7}
                  strokeWidth={isHighlighted ? 2 : 1}
                />
                {/* Small dot at the line end */}
                <circle cx={lx} cy={ly} r={1.8} fill={s.color} />
                {/* Title */}
                <text
                  x={tx}
                  y={ly - 3}
                  fill={s.color}
                  fontSize={13}
                  fontWeight={700}
                  textAnchor={textAnchor}
                  style={{ paintOrder: 'stroke', stroke: palette.textHalo, strokeWidth: 3, strokeLinejoin: 'round' }}
                >
                  {s.label}
                </text>
                {/* Subtitle */}
                <text
                  x={tx}
                  y={ly + 12}
                  fill={palette.subtitle}
                  fontSize={11}
                  fontWeight={400}
                  textAnchor={textAnchor}
                  style={{ paintOrder: 'stroke', stroke: palette.textHalo, strokeWidth: 3, strokeLinejoin: 'round' }}
                >
                  {s.sub}
                </text>
                {/* Thumbnail image */}
                {(() => {
                  const imgSize = 48;
                  const imgGap = 6;
                  const imgX = textAnchor === 'start'
                    ? tx
                    : textAnchor === 'end'
                      ? tx - imgSize
                      : tx - imgSize / 2;
                  const imgY = ly + 12 + imgGap;
                  return (
                    <g transform={`translate(${imgX} ${imgY})`}>
                      <rect
                        width={imgSize}
                        height={imgSize}
                        rx={6}
                        ry={6}
                        fill={palette.ocean}
                        stroke={s.color}
                        strokeWidth={1.5}
                        strokeOpacity={0.6}
                      />
                      <image
                        href={s.image}
                        width={imgSize}
                        height={imgSize}
                        clipPath={`url(#clip-${s.id})`}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </g>
                  );
                })()}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Loading hint */}
      {!countries && (
        <div className={`absolute inset-0 flex items-center justify-center text-xs ${palette.loading}`}>
          Loading map data…
        </div>
      )}
    </div>
  );
}
