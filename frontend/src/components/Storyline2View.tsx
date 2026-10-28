import {
  Mountain, Flame, Wrench, Cpu, Zap, Recycle,
  Cloud, Lock, Factory, Truck, Stethoscope,
  ArrowRightCircle, ImageIcon, Leaf, Shield, Clock, Settings,
  Landmark, Scale,
} from 'lucide-react';

// ── Data ─────────────────────────────────────────────────────────────

const ACCENT = '#02CDBA';

interface CardData {
  step: number;
  heading: string;
  subheading: string;
  image?: string;
  tags: { icon: React.ComponentType<{ className?: string }>; label: string }[];
}

const CARDS: CardData[] = [
  {
    step: 1,
    heading: 'RAW MATERIAL',
    subheading: 'Aluminum Ingot',
    image: '/images/materials/Storyline-1.png',
    tags: [
      { icon: Mountain, label: 'Mining & Refining' },
      { icon: Zap, label: 'Energy Intensive' },
    ],
  },
  {
    step: 2,
    heading: 'COMPONENT',
    subheading: 'Aluminum Casting',
    image: '/images/materials/Storyline-2.png',
    tags: [
      { icon: Flame, label: 'Casting & Heat Treatment' },
      { icon: Leaf, label: 'Material Efficiency' },
    ],
  },
  {
    step: 3,
    heading: 'SUBASSEMBLY',
    subheading: 'X-ray Tube',
    image: '/images/materials/Storyline-3.png',
    tags: [
      { icon: Wrench, label: 'Manufacturing & Assembly' },
      { icon: Shield, label: 'Precision & Quality' },
    ],
  },
  {
    step: 4,
    heading: 'FINAL PRODUCT',
    subheading: 'CT System',
    image: '/images/materials/Storyline-4.png',
    tags: [
      { icon: Cpu, label: 'Integration & Testing' },
      { icon: Clock, label: 'Durability & Reliability' },
    ],
  },
  {
    step: 5,
    heading: 'USE PHASE',
    subheading: 'In Operation',
    image: '/images/materials/Storyline-5.png',
    tags: [
      { icon: Zap, label: 'Energy Consumption' },
      { icon: Settings, label: 'Efficient Technologies' },
    ],
  },
  {
    step: 6,
    heading: 'END OF LIFE',
    subheading: 'Take-back & Recycling',
    image: '/images/materials/Storyline-6.png',
    tags: [
      { icon: Recycle, label: 'Disassembly & Recycling' },
      { icon: Leaf, label: 'Circular Economy' },
    ],
  },
];

interface Actor {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const LEFT_ACTORS: Actor[] = [
  { icon: Mountain, label: 'Raw Material Supplier' },
  { icon: Truck, label: 'Supplier' },
  { icon: Factory, label: 'Manufacturer' },
];

const RIGHT_ACTORS: Actor[] = [
  { icon: Stethoscope, label: 'Customer/Clinic' },
  { icon: Recycle, label: 'Recycling Partner' },
  { icon: Landmark, label: 'Regulatory Authority' },
  { icon: Scale, label: 'Standardization Body' },
];

// ── Components ───────────────────────────────────────────────────────

function LifecycleCard({ data }: { data: CardData }) {
  return (
    <div className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 shadow-md flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-1">
        <span className="text-2xl font-bold" style={{ color: ACCENT }}>
          {data.step}
        </span>
        <h3 className="text-sm font-bold tracking-wide text-slate-900 dark:text-white mt-1">
          {data.heading}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {data.subheading}
        </p>
      </div>

      {/* Image - fixed 16:9, full card width */}
      <div className="my-2 aspect-[16/9] bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center overflow-hidden">
        {data.image ? (
          <img src={data.image} alt={data.heading} className="w-full h-full object-cover" />
        ) : (
          <ImageIcon className="w-6 h-6 text-slate-300 dark:text-slate-500" />
        )}
      </div>

      {/* Tags */}
      <div className="px-4 pb-3 mt-auto space-y-1.5">
        {data.tags.map((tag, i) => {
          const Icon = tag.icon;
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${ACCENT}20`, border: `1.5px solid ${ACCENT}` }}
              >
                <Icon className="w-3.5 h-3.5 text-[#02CDBA]" />
              </span>
              <span className="text-xs text-slate-700 dark:text-slate-300 leading-tight">
                {tag.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArrowConnector() {
  return (
    <div className="flex items-center justify-center shrink-0 px-1">
      <ArrowRightCircle
        className="w-7 h-7"
        style={{ color: ACCENT }}
        fill={ACCENT}
        stroke="white"
        strokeWidth={1.5}
      />
    </div>
  );
}

function ActorNode({ actor }: { actor: Actor }) {
  const Icon = actor.icon;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ backgroundColor: `${ACCENT}15`, border: `2px solid ${ACCENT}` }}
      >
        <Icon className="w-6 h-6 text-[#02CDBA]" />
      </span>
      <span className="text-xs text-center font-medium text-slate-700 dark:text-slate-300 max-w-[110px] leading-tight">
        {actor.label}
      </span>
    </div>
  );
}

// ── Main View ────────────────────────────────────────────────────────

export function Storyline2View() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-50 dark:bg-background">
      <div className="w-full h-full flex flex-col justify-between px-10 py-6 gap-6">

        {/* ── Top Row: 6 Lifecycle Cards with Arrows ── */}
        <div className="flex items-stretch justify-center gap-0 shrink-0 max-h-[380px]">
          {CARDS.map((card, i) => (
            <div key={card.step} className="contents">
              <LifecycleCard data={card} />
              {i < CARDS.length - 1 && <ArrowConnector />}
            </div>
          ))}
        </div>

        {/* ── Bottom: Data Space Ecosystem — organic radial layout ── */}
        <div className="flex-1 min-h-[240px] relative flex items-center justify-center overflow-hidden rounded-2xl">
          {/* TECH grid background */}
          <div className="absolute inset-0 opacity-[0.07] dark:opacity-[0.12]" style={{
            backgroundImage: `
              linear-gradient(${ACCENT} 1px, transparent 1px),
              linear-gradient(90deg, ${ACCENT} 1px, transparent 1px),
              radial-gradient(circle at 50% 50%, ${ACCENT}40 0%, transparent 70%)
            `,
            backgroundSize: '40px 40px, 40px 40px, 100% 100%',
          }} />
          {/* Radial glow behind hub */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[400px] h-[400px] rounded-full opacity-20 dark:opacity-30"
              style={{ background: `radial-gradient(circle, ${ACCENT}50 0%, transparent 70%)` }} />
          </div>
          {/* Actors distributed organically around the hub — all directions */}
          {/* Top-left: Raw Material Supplier */}
          <div className="absolute left-[8%] top-[5%] flex flex-col items-center animate-float-1">
            <ActorNode actor={LEFT_ACTORS[0]} />
          </div>
          {/* Left: Supplier */}
          <div className="absolute left-[3%] top-1/2 -translate-y-1/2 flex flex-col items-center animate-float-2">
            <ActorNode actor={LEFT_ACTORS[1]} />
          </div>
          {/* Bottom-left: Manufacturer */}
          <div className="absolute left-[8%] bottom-[5%] flex flex-col items-center animate-float-3">
            <ActorNode actor={LEFT_ACTORS[2]} />
          </div>
          {/* Top-right: Customer/Clinic */}
          <div className="absolute right-[28%] top-[2%] flex flex-col items-center animate-float-4">
            <ActorNode actor={RIGHT_ACTORS[0]} />
          </div>
          {/* Right: Recycling Partner */}
          <div className="absolute right-[3%] top-[5%] flex flex-col items-center animate-float-5">
            <ActorNode actor={RIGHT_ACTORS[1]} />
          </div>
          {/* Far-right: Regulatory Authority */}
          <div className="absolute right-[15%] top-[42%] flex flex-col items-center animate-float-6">
            <ActorNode actor={RIGHT_ACTORS[2]} />
          </div>
          {/* Bottom-right: Standardization Body */}
          <div className="absolute right-[3%] bottom-[5%] flex flex-col items-center animate-float-7">
            <ActorNode actor={RIGHT_ACTORS[3]} />
          </div>

          {/* Animated flow lines — ALL flowing TOWARD center hub */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" preserveAspectRatio="none">
            {/* Top-left (Raw Material Supplier) → hub */}
            <line x1="14%" y1="14%" x2="42%" y2="44%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="4" fill={ACCENT} opacity="0.9">
              <animate attributeName="cx" values="14%;42%" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="cy" values="14%;44%" dur="2.5s" repeatCount="indefinite" />
            </circle>
            <circle r="3" fill={ACCENT} opacity="0.5">
              <animate attributeName="cx" values="14%;42%" dur="2.5s" begin="1.2s" repeatCount="indefinite" />
              <animate attributeName="cy" values="14%;44%" dur="2.5s" begin="1.2s" repeatCount="indefinite" />
            </circle>
            {/* Left (Supplier) → hub */}
            <line x1="10%" y1="50%" x2="40%" y2="50%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="3.5" fill={ACCENT} opacity="0.8">
              <animate attributeName="cx" values="10%;40%" dur="2.2s" begin="0.4s" repeatCount="indefinite" />
              <animate attributeName="cy" values="50%;50%" dur="2.2s" begin="0.4s" repeatCount="indefinite" />
            </circle>
            {/* Bottom-left (Manufacturer) → hub */}
            <line x1="14%" y1="86%" x2="42%" y2="56%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="3.5" fill={ACCENT} opacity="0.8">
              <animate attributeName="cx" values="14%;42%" dur="2.3s" begin="0.8s" repeatCount="indefinite" />
              <animate attributeName="cy" values="86%;56%" dur="2.3s" begin="0.8s" repeatCount="indefinite" />
            </circle>
            {/* Top-right (Customer/Clinic) → hub */}
            <line x1="68%" y1="12%" x2="56%" y2="42%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="3.5" fill={ACCENT} opacity="0.8">
              <animate attributeName="cx" values="68%;56%" dur="2s" begin="0.3s" repeatCount="indefinite" />
              <animate attributeName="cy" values="12%;42%" dur="2s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            {/* Far-right top (Recycling) → hub */}
            <line x1="90%" y1="14%" x2="58%" y2="44%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="3.5" fill={ACCENT} opacity="0.7">
              <animate attributeName="cx" values="90%;58%" dur="2.4s" begin="0.6s" repeatCount="indefinite" />
              <animate attributeName="cy" values="14%;44%" dur="2.4s" begin="0.6s" repeatCount="indefinite" />
            </circle>
            {/* Right (Authority) → hub */}
            <line x1="80%" y1="48%" x2="60%" y2="50%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="3.5" fill={ACCENT} opacity="0.7">
              <animate attributeName="cx" values="80%;60%" dur="2.3s" begin="1s" repeatCount="indefinite" />
              <animate attributeName="cy" values="48%;50%" dur="2.3s" begin="1s" repeatCount="indefinite" />
            </circle>
            {/* Bottom-right (Standardization) → hub */}
            <line x1="86%" y1="86%" x2="58%" y2="56%" stroke={ACCENT} strokeWidth="2" strokeOpacity="0.2" />
            <circle r="3" fill={ACCENT} opacity="0.7">
              <animate attributeName="cx" values="86%;58%" dur="2.1s" begin="0.5s" repeatCount="indefinite" />
              <animate attributeName="cy" values="86%;56%" dur="2.1s" begin="0.5s" repeatCount="indefinite" />
            </circle>
          </svg>

          {/* Central circular Data Space Hub — large & prominent, scales up on big screens */}
          <div className="relative shrink-0 flex items-center justify-center z-10 scale-100 xl:scale-110 2xl:scale-125 transition-transform">
            {/* Outer orbital ring with animated particles */}
            <div className="absolute w-[240px] h-[240px] rounded-full animate-spin-slow"
              style={{ border: `2px dashed ${ACCENT}40` }}>
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full shadow-lg"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 14px ${ACCENT}` }} />
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full shadow-lg"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 10px ${ACCENT}`, opacity: 0.7 }} />
              <span className="absolute top-1/2 -left-2 -translate-y-1/2 w-3 h-3 rounded-full shadow-lg"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 10px ${ACCENT}`, opacity: 0.6 }} />
              <span className="absolute top-1/4 -right-1.5 w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, opacity: 0.5 }} />
            </div>
            {/* Second orbital ring — counter rotation */}
            <div className="absolute w-[210px] h-[210px] rounded-full animate-spin-reverse"
              style={{ border: `1.5px dashed ${ACCENT}30` }}>
              <span className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-3 rounded-full"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 10px ${ACCENT}`, opacity: 0.7 }} />
              <span className="absolute -top-1.5 left-1/3 w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 8px ${ACCENT}`, opacity: 0.5 }} />
              <span className="absolute -bottom-1 right-1/4 w-2 h-2 rounded-full"
                style={{ backgroundColor: ACCENT, boxShadow: `0 0 6px ${ACCENT}`, opacity: 0.4 }} />
            </div>
            {/* Pulsing glow ring */}
            <div className="absolute w-[185px] h-[185px] rounded-full animate-pulse-glow"
              style={{ border: `2.5px solid ${ACCENT}60`, boxShadow: `0 0 30px ${ACCENT}40, inset 0 0 30px ${ACCENT}15` }} />
            {/* Inner hub content */}
            <div className="relative w-[160px] h-[160px] rounded-full flex flex-col items-center justify-center bg-white dark:bg-slate-800 border-[3px] shadow-2xl z-10"
              style={{ borderColor: ACCENT, boxShadow: `0 0 40px ${ACCENT}25` }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Cloud className="w-7 h-7 text-[#02CDBA]" />
                <Lock className="w-5 h-5 text-[#02CDBA]" />
              </div>
              <span className="text-sm font-bold text-slate-900 dark:text-white leading-tight text-center">
                HealthTrack-X
              </span>
              <span className="text-[9px] text-slate-500 dark:text-slate-400 text-center leading-tight mt-0.5 px-3">
                Secure Data Space
              </span>
            </div>
          </div>

          {/* Description overlay below hub */}
          <p className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Secure data space for transparent, verified and standardized CO₂e data
          </p>
        </div>

      </div>
    </div>
  );
}
