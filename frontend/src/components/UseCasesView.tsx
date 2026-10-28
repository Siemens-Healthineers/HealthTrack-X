// Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
// trademarks of the Industrial Digital Twin Association (IDTA), referenced here
// for identification and interoperability purposes only.
import {
  Mountain, Flame, Tag, Package, Paintbrush, Cable, Cpu, Wrench,
  BookOpen, Puzzle, PenTool, Heart, FlaskConical, RotateCcw, Fuel,
  TestTubes, AlertTriangle, Hexagon, Fingerprint, ListTree,
  ScrollText,
} from 'lucide-react';
import { useAppProfile, type AppProfile } from '../contexts/AppProfileContext';

// ── Constants ────────────────────────────────────────────────────────

const ACCENT = '#02CDBA';

const PROFILE_MAP: Record<string, AppProfile> = {
  'Raw Material (ROH)': 'raw-material',
  'Semi-finished Good (HALB)': 'semi-finished-good',
  'Finished Product (FERT)': 'finished-product',
  'Medical Device (END)': 'medical-device',
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'Raw Material (ROH)': Mountain,
  'Semi-finished Good (HALB)': Flame,
  'Label': Tag,
  'Packaging': Package,
  'Surfaces/Coatings': Paintbrush,
  'Cabling': Cable,
  'PCBA': Cpu,
  'Standard Parts': Wrench,
  'Catalog Parts': BookOpen,
  'Custom Parts': Puzzle,
  'Finished Product (FERT)': PenTool,
  'Medical Device (END)': Heart,
  'Auxiliary Materials': FlaskConical,
  'Consumables': RotateCcw,
  'Operating Materials': Fuel,
  'Additives': TestTubes,
  'Hazardous': AlertTriangle,
};

const IMAGE_MAP: Record<string, string> = {
  'Raw Material (ROH)': '/images/materials/Storyline-1.png',
  'Semi-finished Good (HALB)': '/images/materials/Storyline-2.png',
  'Label': '/images/materials/Label.png',
  'Packaging': '/images/materials/Packaging.png',
  'Surfaces/Coatings': '/images/materials/Coating.png',
  'Cabling': '/images/materials/Cabling.png',
  'PCBA': '/images/materials/pcba.png',
  'Standard Parts': '/images/materials/Standard-Parts.png',
  'Catalog Parts': '/images/materials/Catalog-Parts.png',
  'Custom Parts': '/images/materials/Custom-Parts.png',
  'Finished Product (FERT)': '/images/materials/Storyline-3.png',
  'Medical Device (END)': '/images/materials/Storyline-4.png',
  'Auxiliary Materials': '/images/materials/Auxiliary-Materials.png',
  'Consumables': '/images/materials/Consumables.png',
  'Operating Materials': '/images/materials/Operating-Materials.png',
  'Additives': '/images/materials/Additives.png',
  'Hazardous': '/images/materials/Hazardous.png',
};

const DIRECT_ITEMS = [
  'Raw Material (ROH)', 'Semi-finished Good (HALB)', 'Label', 'Packaging', 'Surfaces/Coatings', 'Cabling',
  'PCBA', 'Standard Parts', 'Catalog Parts', 'Custom Parts', 'Finished Product (FERT)', 'Medical Device (END)',
] as const;

const INDIRECT_ITEMS = [
  'Auxiliary Materials', 'Consumables', 'Operating Materials', 'Additives', 'Hazardous',
] as const;

// ── Standards Data ───────────────────────────────────────────────────

interface StandardItem {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}

const STANDARDS: StandardItem[] = [
  { icon: Hexagon, label: 'Asset Administration Shell', description: 'Industry 4.0 digital twin standard (IEC 63278)' },
  { icon: Fingerprint, label: 'Digital Product Passport', description: 'EU regulation for product lifecycle transparency' },
  { icon: ListTree, label: 'IEC 61360 Classification', description: 'International electrotechnical classification system' },
  { icon: ScrollText, label: 'ISO Standards', description: 'ISO 14001, ISO 14040/44 LCA, ISO 22095 traceability' },
];

// ── Card Component ───────────────────────────────────────────────────

function UseCaseCard({ name, onClick, isActive, isClickable }: {
  name: string;
  onClick?: () => void;
  isActive: boolean;
  isClickable: boolean;
}) {
  const image = IMAGE_MAP[name];
  const Icon = ICON_MAP[name] || Package;

  return (
    <div
      onClick={isClickable ? onClick : undefined}
      className={`
        rounded-xl border bg-white dark:bg-slate-800/90 shadow-md flex flex-col overflow-hidden
        transition-[transform,box-shadow,opacity]
        ${isClickable
          ? 'cursor-pointer hover:shadow-xl hover:scale-[1.03]'
          : 'opacity-40 saturate-[0.3] cursor-default'}
        ${isActive
          ? 'border-[#02CDBA] ring-2 ring-[#02CDBA] ring-offset-2 ring-offset-background'
          : 'border-slate-200 dark:border-slate-700'}
      `}
    >
      {/* Image - 16:9 */}
      <div className="aspect-[16/9] bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center overflow-hidden">
        {image ? (
          <img src={image} alt={name} className="w-full h-full object-cover" />
        ) : (
          <Icon className="w-8 h-8 text-slate-300 dark:text-slate-500" />
        )}
      </div>

      {/* Heading */}
      <div className="px-3 py-2.5">
        <h3 className="text-xs font-bold tracking-wide text-slate-900 dark:text-white text-center leading-tight">
          {name}
        </h3>
      </div>
    </div>
  );
}

// ── Standard Badge Component ─────────────────────────────────────────

function StandardBadge({ standard }: { standard: StandardItem }) {
  const Icon = standard.icon;
  return (
    <div className="flex min-[1800px]:flex-col items-center min-[1800px]:text-center gap-2 px-3 py-2 min-[1800px]:py-3 rounded-lg min-[1800px]:rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 shadow-sm">
      <span
        className="w-8 h-8 min-[1800px]:w-14 min-[1800px]:h-14 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${ACCENT}15`, border: `1.5px solid ${ACCENT}` }}
      >
        <Icon className="w-4 h-4 min-[1800px]:w-6 min-[1800px]:h-6 text-[#02CDBA]" />
      </span>
      <div className="min-w-0">
        <h4 className="text-xs min-[1800px]:text-sm font-semibold text-slate-900 dark:text-white leading-tight">{standard.label}</h4>
        <p className="text-[10px] min-[1800px]:text-xs text-slate-500 dark:text-slate-400 leading-tight mt-0.5">{standard.description}</p>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function UseCasesView() {
  const { appProfile, setAppProfile } = useAppProfile();

  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-50 dark:bg-background">
      <div className="w-full h-full flex flex-col px-10 py-5 gap-4 min-[1800px]:gap-8">
        {/* Direct Materials */}
        <section className="flex-1 min-h-0 flex flex-col max-h-[420px]">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 shrink-0">
            Direct Materials
          </h2>
          <div className="flex-1 min-h-0 grid grid-cols-6 grid-rows-2 gap-4">
            {DIRECT_ITEMS.map((name) => {
              const profile = PROFILE_MAP[name];
              const isActive = !!profile && appProfile === profile;
              return (
                <UseCaseCard
                  key={name}
                  name={name}
                  isActive={isActive}
                  isClickable={!!profile}
                  onClick={profile ? () => setAppProfile(profile) : undefined}
                />
              );
            })}
          </div>
        </section>

        {/* Indirect Materials */}
        <section className="shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Indirect Materials
          </h2>
          <div className="grid grid-cols-6 gap-4">
            {INDIRECT_ITEMS.map((name) => (
              <UseCaseCard
                key={name}
                name={name}
                isActive={false}
                isClickable={false}
              />
            ))}
          </div>
        </section>

        {/* Standards */}
        <section className="shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
            Applied Standards & Regulations
          </h2>
          <div className="grid grid-cols-5 gap-4">
            {STANDARDS.map((standard) => (
              <StandardBadge key={standard.label} standard={standard} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
