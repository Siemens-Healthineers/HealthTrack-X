import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from './ui/badge';

export interface HalbChemicalEntry {
  element: string;
  cas?: string;
  avg?: number;
  min?: number;
  max?: number;
}

export interface HalbCrmaEntry {
  element: string;
  cas?: string;
  critical?: boolean;
  strategic?: boolean;
}

export interface HalbMaterialData {
  productId?: string;
  productName?: string;
  materialName?: string;
  materialId?: string;
  designation?: string;
  materialNumber?: string;
  alloyGroup?: string;
  nomenclatureStandard?: string;
  classificationStandard?: string;
  classificationCategory?: string;
  classificationClass?: string;
  classificationSubclass?: string;
  compositionStandard?: string;
  compositionUnit?: string;
  chemicalComposition?: HalbChemicalEntry[];
  crmaStatus?: string;
  crmaDetails?: HalbCrmaEntry[];
}

interface MaterialCompositionContentProps {
  material: HalbMaterialData | null;
  materialName?: string;
  loading: boolean;
  error: string | null;
}

const DETAIL_GRID_CLASS = 'grid grid-cols-[110px_1fr] gap-y-2.5 gap-x-3 items-baseline';

function DetailLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
      {children}
    </span>
  );
}

function DetailValue({ children, mono }: { children?: ReactNode; mono?: boolean }) {
  return (
    <span className={`text-sm ${mono ? 'font-mono' : ''} break-all`}>
      {children || <span className="text-muted-foreground">—</span>}
    </span>
  );
}

export function MaterialCompositionContent({ material, materialName, loading, error }: MaterialCompositionContentProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Looking up material data…</span>
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-muted-foreground py-4 text-center">{error}</div>;
  }

  if (!material) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No matching material found in Semi-finished Good (HALB) data for &quot;{materialName}&quot;.
      </div>
    );
  }

  return (
    <>
      {/* Material Identification */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Material Identification
          </h4>
          {material.nomenclatureStandard && (
            <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
              {material.nomenclatureStandard}
            </Badge>
          )}
        </div>
        <div className={DETAIL_GRID_CLASS}>
          <DetailLabel>Material ID</DetailLabel>
          <DetailValue mono>{material.materialId}</DetailValue>

          <DetailLabel>Designation</DetailLabel>
          <DetailValue>{material.designation}</DetailValue>

          <DetailLabel>Material Number</DetailLabel>
          <DetailValue mono>{material.materialNumber}</DetailValue>

          <DetailLabel>Alloy Group</DetailLabel>
          <DetailValue>{material.alloyGroup}</DetailValue>
        </div>
      </div>

      <hr className="border-border" />

      {/* Chemical Composition */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Chemical Composition
          </h4>
          {material.compositionStandard && (
            <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
              {material.compositionStandard}
            </Badge>
          )}
        </div>
        {Array.isArray(material.chemicalComposition) && material.chemicalComposition.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Element</th>
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">CAS</th>
                <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">%</th>
              </tr>
            </thead>
            <tbody>
              {material.chemicalComposition.map((entry, index) => {
                let fraction: string;
                if (entry.avg != null) fraction = String(entry.avg);
                else if (entry.min != null && entry.max != null) fraction = `${entry.min}–${entry.max}`;
                else if (entry.min != null) fraction = `≥${entry.min}`;
                else if (entry.max != null) fraction = `≤${entry.max}`;
                else fraction = '—';
                return (
                  <tr key={`${entry.element}-${index}`} className={index % 2 === 0 ? '' : 'bg-muted/30'}>
                    <td className="px-3 py-1.5 font-medium">{entry.element}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{entry.cas || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fraction}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground py-2">No composition data available.</p>
        )}
      </div>

      <hr className="border-border" />

      {/* EU CRMA */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            EU CRMA Results
          </h4>
          <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
            CRMA-Annex-I-2023
          </Badge>
        </div>
        {Array.isArray(material.crmaDetails) && material.crmaDetails.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Element</th>
                <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">CAS</th>
                <th className="text-center px-3 py-1.5 text-xs font-medium text-muted-foreground">Critical</th>
                <th className="text-center px-3 py-1.5 text-xs font-medium text-muted-foreground">Strategic</th>
              </tr>
            </thead>
            <tbody>
              {material.crmaDetails.map((entry, index) => (
                <tr key={`${entry.element}-${index}`} className={index % 2 === 0 ? '' : 'bg-muted/30'}>
                  <td className="px-3 py-1.5 font-medium">{entry.element}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{entry.cas || '—'}</td>
                  <td className="px-3 py-1.5 text-center">
                    {entry.critical
                      ? <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Critical" />
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {entry.strategic
                      ? <span className="inline-block w-2 h-2 rounded-full bg-orange-500" title="Strategic" />
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground py-2">
            {material.crmaStatus ? 'No CRMA-listed elements found.' : 'No CRMA data available.'}
          </p>
        )}
      </div>
    </>
  );
}