/**
 * MaterialDetailPanel – sliding side panel for semi-finished-good (HALB) materials.
 *
 * Mirrors the pattern from FinishedProductBomView:
 *   - 480px wide panel, CSS transition, push layout
 *   - Three sections: Material Identification, Material Classification, Chemical Composition
 *   - Read-only detail view, no edit capability
 */

import { X, Atom, FlaskConical, Tag, ShieldAlert } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

// ── Types ──────────────────────────────────────────────────────

interface ChemicalElement {
  element: string;
  cas?: string;
  avg?: number;
  min?: number;
  max?: number;
  fractionType?: string;
}

export interface MaterialRecord {
  productId: string;
  productName?: string;
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
  chemicalComposition?: ChemicalElement[];
  githubUrl?: string;
  crmaStatus?: string;
  crmaDetails?: { element: string; cas: string; critical: boolean; strategic: boolean; materialName: string }[];
  [key: string]: unknown;
}

// ── Main Component ─────────────────────────────────────────────

export function MaterialDetailPanel({
  material,
  onClose,
}: {
  material: MaterialRecord | null;
  onClose: () => void;
}) {
  return (
    <div
      className={`border-l bg-background overflow-y-auto transition-[width,min-width,opacity] duration-200 ease-in-out ${
        material ? 'w-[480px] min-w-[480px] opacity-100' : 'w-0 min-w-0 opacity-0 overflow-hidden'
      }`}
    >
      {material && <PanelContent material={material} onClose={onClose} />}
    </div>
  );
}

// ── Panel Content ──────────────────────────────────────────────

function PanelContent({
  material,
  onClose,
}: {
  material: MaterialRecord;
  onClose: () => void;
}) {
  const composition: ChemicalElement[] = Array.isArray(material.chemicalComposition)
    ? material.chemicalComposition
    : [];

  // Build a CAS → element-abbreviation lookup from chemicalComposition
  // so CRMA details use the same short element names
  const casToElement = new Map<string, string>();
  for (const el of composition) {
    if (el.cas) casToElement.set(el.cas, el.element);
  }

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold truncate" title={material.designation || material.productName}>
            {material.designation || material.productName || '—'}
          </h3>
          <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
            {material.productId}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="basic" className="flex-1 text-xs">Basic Information</TabsTrigger>
          <TabsTrigger value="crma" className="flex-1 text-xs">EU CRMA</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Basic Information ─────────────────────────── */}
        <TabsContent value="basic" className="space-y-5 mt-4">
          {/* Material Identification */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Material Identification
                </h4>
              </div>
              {material.nomenclatureStandard && (
                <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                  {material.nomenclatureStandard}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-y-2.5 gap-x-3 items-baseline">
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

          {/* Material Classification */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Material Classification
                </h4>
              </div>
              {material.classificationStandard && (
                <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                  {material.classificationStandard}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-[130px_1fr] gap-y-2.5 gap-x-3 items-baseline">
              <DetailLabel>Category</DetailLabel>
              <DetailValue>{material.classificationCategory}</DetailValue>

              <DetailLabel>Class</DetailLabel>
              <DetailValue>{material.classificationClass}</DetailValue>

              <DetailLabel>Subclass</DetailLabel>
              <DetailValue>{material.classificationSubclass}</DetailValue>
            </div>
          </div>

          <hr className="border-border" />

          {/* Chemical Composition */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Atom className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Chemical Composition
                </h4>
              </div>
              {material.compositionStandard && (
                <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                  {material.compositionStandard}
                </Badge>
              )}
            </div>

            {composition.length > 0 ? (
              <div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Element</th>
                      <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">CAS</th>
                      <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {composition.map((el, idx) => {
                      let fraction: string;
                      if (el.avg != null) {
                        fraction = String(el.avg);
                      } else if (el.min != null && el.max != null) {
                        fraction = `${el.min}–${el.max}`;
                      } else if (el.min != null) {
                        fraction = `≥${el.min}`;
                      } else if (el.max != null) {
                        fraction = `≤${el.max}`;
                      } else {
                        fraction = '—';
                      }
                      return (
                        <tr
                          key={`${el.element}-${idx}`}
                          className={idx % 2 === 0 ? '' : 'bg-muted/30'}
                        >
                          <td className="px-3 py-1.5 font-medium">{el.element}</td>
                          <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                            {el.cas || '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {fraction}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">No composition data available.</p>
            )}
          </div>
        </TabsContent>

        {/* ── Tab 2: EU CRMA ──────────────────────────────────── */}
        <TabsContent value="crma" className="space-y-5 mt-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Critical Raw Materials
                </h4>
              </div>
              <Badge className="text-[10px] font-normal bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 hover:bg-emerald-100">
                CRMA-Annex-I-2023
              </Badge>
            </div>

            {Array.isArray(material.crmaDetails) && material.crmaDetails.length > 0 ? (
              <div>
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
                    {material.crmaDetails.map((d, idx) => (
                      <tr
                        key={`${d.element}-${idx}`}
                        className={idx % 2 === 0 ? '' : 'bg-muted/30'}
                      >
                        <td className="px-3 py-1.5 font-medium">
                          {casToElement.get(d.cas) || d.element}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{d.cas || '—'}</td>
                        <td className="px-3 py-1.5 text-center">
                          {d.critical
                            ? <span className="inline-block w-2 h-2 rounded-full bg-red-500" title="Critical" />
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {d.strategic
                            ? <span className="inline-block w-2 h-2 rounded-full bg-orange-500" title="Strategic" />
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                {material.crmaStatus ? 'No CRMA-listed elements found in composition.' : 'No CRMA data available.'}
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Reusable grid cells (same pattern as FinishedProductBomView) ──

function DetailLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
      {children}
    </span>
  );
}

function DetailValue({ children, mono }: { children?: React.ReactNode; mono?: boolean }) {
  return (
    <span className={`text-sm ${mono ? 'font-mono' : ''} break-all`}>
      {children || <span className="text-muted-foreground">—</span>}
    </span>
  );
}
