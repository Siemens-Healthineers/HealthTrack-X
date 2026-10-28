/**
 * FinishedProductEditForm — full-page dialog form for editing a Finished Product BOM node.
 *
 * Two input modes (tabs):
 *   1. Manual Entry ("Basic Information") — read-only identification + editable fields
 *   2. AAS Import — parse AAS JSON file and extract Nameplate + TechnicalData
 */

// Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
// trademarks of the Industrial Digital Twin Association (IDTA), referenced here
// for identification and interoperability purposes only.

import { useState, useRef, useMemo, Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Badge } from './ui/badge';
import { useToast } from './ui/use-toast';
import { Loader2, PenLine, FileJson, Upload, CheckCircle2 } from 'lucide-react';
import { useAppProfile } from '../contexts/AppProfileContext';
import { apiFetch } from '../config/api';
import { useSchemaFields, identifierFields, fieldLabel } from '../hooks/useSchemaFields';
import { IEC_CLASS_DESCRIPTIONS, getIecClass } from '../lib/iec81346';
import type { BomNode } from './BomTreeTable';

interface FinishedProductEditFormProps {
  node: BomNode;
  onSuccess?: (updatedNode: BomNode) => void;
}

// ── AAS JSON parsing helpers ──────────────────────────────────

interface AasParsedData {
  // Nameplate
  uriOfTheProduct?: string;
  manufacturerName?: string;
  manufacturerProductDesignation?: string;
  manufacturerProductType?: string;
  productArticleNumberOfManufacturer?: string;
  // TechnicalData - ProductClassifications
  classificationSystem?: string;
  classificationSystemVersion?: string;
  productClassId?: string;
  productClassCodedName?: string;
  productClassName?: string;
  // TechnicalData - Properties
  netWeight?: string;
  uriOfManufacturer?: string;
  glnOfManufacturer?: string;
  uriOfTheProductTechnical?: string;
  internalArticleNumber?: string;
  gtinEanCode?: string;
}

function validateAasStructure(json: unknown): asserts json is { submodels: any[] } {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid AAS file: expected a JSON object.');
  }
  const submodels = (json as { submodels?: unknown }).submodels;
  if (!Array.isArray(submodels) || submodels.length === 0) {
    throw new Error('Invalid AAS file: missing submodels array.');
  }

  const hasSupportedSubmodel = submodels.some((sm: any) => {
    const idShort = String(sm?.idShort || '').toLowerCase();
    const semanticIds = Array.isArray(sm?.semanticId?.keys) ? sm.semanticId.keys : [];
    return idShort === 'nameplate'
      || idShort === 'technicaldata'
      || semanticIds.some((key: any) => {
        const value = String(key?.value || '').toLowerCase();
        return value.includes('nameplate') || value.includes('technicaldata');
      });
  });

  if (!hasSupportedSubmodel) {
    throw new Error('Invalid AAS file: expected Nameplate or TechnicalData submodel.');
  }
}

function getMultiLangText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const en = value.find((v: { language?: string }) => v.language === 'en' || v.language === 'en-US');
    return en?.text || value[0]?.text || '';
  }
  return '';
}

function findSubmodelElement(elements: any[], idShort: string): any | undefined {
  if (!Array.isArray(elements)) return undefined;
  for (const el of elements) {
    if (el.idShort === idShort) return el;
    // Search in nested collections/lists
    if (Array.isArray(el.value)) {
      const found = findSubmodelElement(el.value, idShort);
      if (found) return found;
    }
  }
  return undefined;
}

function parseAasJson(json: any): AasParsedData {
  const result: AasParsedData = {};

  const submodels: any[] = json.submodels || [];

  // Find Nameplate submodel
  const nameplate = submodels.find((sm) =>
    sm.idShort === 'Nameplate' ||
    sm.semanticId?.keys?.some((k: any) => k.value?.includes('nameplate'))
  );
  if (nameplate?.submodelElements) {
    const els = nameplate.submodelElements;
    const uri = els.find((e: any) => e.idShort === 'URIOfTheProduct');
    if (uri) result.uriOfTheProduct = uri.value || '';

    const mfName = els.find((e: any) => e.idShort === 'ManufacturerName');
    if (mfName) result.manufacturerName = getMultiLangText(mfName.value);

    const mfDesig = els.find((e: any) => e.idShort === 'ManufacturerProductDesignation');
    if (mfDesig) result.manufacturerProductDesignation = getMultiLangText(mfDesig.value);

    const mfType = els.find((e: any) => e.idShort === 'ManufacturerProductType');
    if (mfType) result.manufacturerProductType = getMultiLangText(mfType.value);

    const artNo = els.find((e: any) => e.idShort === 'ProductArticleNumberOfManufacturer');
    if (artNo) result.productArticleNumberOfManufacturer = getMultiLangText(artNo.value) || artNo.value || '';
  }

  // Find TechnicalData submodel (prefer v2 with SubmodelElementList)
  const techDataList = submodels.filter((sm) =>
    sm.idShort === 'TechnicalData' ||
    sm.semanticId?.keys?.some((k: any) => k.value?.includes('TechnicalData'))
  );
  // Prefer the one with SubmodelElementList (v2)
  const techData = techDataList.find((sm) =>
    sm.submodelElements?.some((e: any) => e.modelType === 'SubmodelElementList')
  ) || techDataList[0];

  if (techData?.submodelElements) {
    const els = techData.submodelElements;

    // ProductClassifications
    const pcEl = els.find((e: any) => e.idShort === 'ProductClassifications');
    if (pcEl) {
      // Could be SubmodelElementList or SubmodelElementCollection
      const classifications = pcEl.modelType === 'SubmodelElementList'
        ? pcEl.value : [pcEl];
      const firstClass = Array.isArray(classifications) ? classifications[0] : null;
      if (firstClass?.value) {
        const classEls = firstClass.value;
        const cs = classEls.find((e: any) => e.idShort === 'ClassificationSystem');
        if (cs) result.classificationSystem = cs.value || '';
        const csv = classEls.find((e: any) => e.idShort === 'ClassificationSystemVersion');
        if (csv) result.classificationSystemVersion = csv.value || '';
        const pcId = classEls.find((e: any) => e.idShort === 'ProductClassId');
        if (pcId) result.productClassId = pcId.value || '';
        const pcCoded = classEls.find((e: any) => e.idShort === 'ProductClassCodedName');
        if (pcCoded) result.productClassCodedName = pcCoded.value || '';
        const pcName = classEls.find((e: any) => e.idShort === 'ProductClassName');
        if (pcName) result.productClassName = getMultiLangText(pcName.value) || pcName.value || '';
      }
    }

    // TechnicalPropertyAreas / TechnicalProperties — find specific fields
    const netWeight = findSubmodelElement(els, 'AAF040_Net_weight');
    if (netWeight) result.netWeight = netWeight.value || '';

    const uriMfr = findSubmodelElement(els, 'ABA669_URI_of_manufacturer');
    if (uriMfr) result.uriOfManufacturer = uriMfr.value || '';

    const gln = findSubmodelElement(els, 'AAY812_GLN_of_manufacturer');
    if (gln) result.glnOfManufacturer = gln.value || '';

    const uriProd = findSubmodelElement(els, 'ABH173_URI_of_the_product');
    if (uriProd) result.uriOfTheProductTechnical = uriProd.value || '';

    const intArt = findSubmodelElement(els, 'AAO676_Internal_article_number');
    if (intArt) result.internalArticleNumber = intArt.value || '';

    const gtin = findSubmodelElement(els, 'AAO663_GTIN__EAN__code');
    if (gtin) result.gtinEanCode = gtin.value || '';
  }

  return result;
}

function hasParsedAasData(data: AasParsedData): boolean {
  return Object.values(data).some(Boolean);
}

export function FinishedProductEditForm({ node, onSuccess }: FinishedProductEditFormProps) {
  const { toast } = useToast();
  const { configId, dataFolder } = useAppProfile();
  const { schemaFields } = useSchemaFields();
  // Identifier fields derived from the data-repo schema (not hard-coded)
  const idFields = useMemo(() => identifierFields(schemaFields), [schemaFields]);

  // Editable fields
  const [materialName, setMaterialName] = useState(node.materialName || '');
  const [description, setDescription] = useState(node.description || '');
  const [iecClass, setIecClass] = useState(getIecClass(node));
  const [saving, setSaving] = useState(false);

  // AAS Import state
  const [aasData, setAasData] = useState<AasParsedData | null>(null);
  const [aasFileName, setAasFileName] = useState<string | null>(null);
  const [aasCommitting, setAasCommitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      const folder = dataFolder || 'products';
      const payload: Record<string, unknown> = {
        productId: node.productId,
        nodeId: node.nodeId,
        name: node.name,
        parentId: node.parentId || '',
        modelType: node.modelType,
        quantity: node.quantity ? String(node.quantity) : '1',
        manufacturer: node.manufacturer || '',
        materialName,
        weight: node.weight || '',
        description,
        iec81346Class: iecClass,
        iec81346Number: node.iec81346Number || '',
        githubUrl: node.githubUrl || '',
        materialId: node.materialId || '',
        valueType: node.valueType || '',
        propertyValue: node.propertyValue || '',
        edcAssetId: node.edcAssetId || '',
        edcAssetName: node.edcAssetName || '',
        hasChildren: node.hasChildren || '',
      };
      // Preserve any schema-declared identifier fields without hard-coding their names
      for (const f of idFields) {
        if (!(f.field in payload)) payload[f.field] = node[f.field] ?? '';
      }

      const requestData: Record<string, unknown> = {
        file_path: `data/${folder}/`,
        data: payload,
      };
      if (configId) requestData.config_id = configId;

      const res = await apiFetch('/api/write-json-async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      toast({ title: 'Committed', description: `"${node.name}" queued for processing.` });
      onSuccess?.({ ...node, materialName, description, iec81346Class: iecClass });
    } catch (error) {
      toast({
        title: 'Commit failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAasFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processAasFile(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.json')) {
      await processAasFile(file);
    } else {
      toast({ title: 'Invalid file', description: 'Please drop a .json file.', variant: 'destructive' });
    }
  };

  const processAasFile = async (file: File) => {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      validateAasStructure(json);
      const parsed = parseAasJson(json);
      if (!hasParsedAasData(parsed)) {
        throw new Error('AAS file was valid, but no supported Nameplate or TechnicalData fields were found.');
      }
      setAasData(parsed);
      setAasFileName(file.name);
      toast({ title: 'AAS Parsed', description: `Extracted data from "${file.name}"` });
    } catch (err) {
      toast({
        title: 'Parse Error',
        description: err instanceof Error ? err.message : 'Invalid JSON file',
        variant: 'destructive',
      });
      setAasData(null);
      setAasFileName(null);
    }
  };

  const handleAasCommit = async () => {
    if (!aasData) return;
    setAasCommitting(true);
    try {
      const folder = dataFolder || 'products';
      const payload: Record<string, unknown> = {
        productId: node.productId,
        nodeId: node.nodeId,
        name: node.name,
        parentId: node.parentId || '',
        modelType: node.modelType,
        quantity: node.quantity ? String(node.quantity) : '1',
        manufacturer: node.manufacturer || '',
        materialName: node.materialName || '',
        weight: node.weight || '',
        description,
        iec81346Class: node.iec81346Class || '',
        iec81346Number: node.iec81346Number || '',
        githubUrl: node.githubUrl || '',
        materialId: node.materialId || '',
        valueType: node.valueType || '',
        propertyValue: node.propertyValue || '',
        edcAssetId: node.edcAssetId || '',
        edcAssetName: node.edcAssetName || '',
        hasChildren: node.hasChildren || '',
        // Nameplate fields
        ...aasData,
      };

      const requestData: Record<string, unknown> = {
        file_path: `data/${folder}/`,
        data: payload,
      };
      if (configId) requestData.config_id = configId;

      const res = await apiFetch('/api/write-json-async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const result = await res.json();
      toast({ title: 'Committed', description: `AAS data queued for "${node.name}".` });
      onSuccess?.({ ...node, ...aasData, productId: result.productId || node.productId });
    } catch (error) {
      toast({
        title: 'Commit failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAasCommitting(false);
    }
  };

  return (
    <Card className="w-full max-w-3xl mx-auto border-0 shadow-none">
      <CardHeader>
        <CardTitle>Edit Finished Product</CardTitle>
        <CardDescription>
          Edit product information for BOM node "{node.name}"
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="manual" className="w-full">
          <TabsList className="w-full mb-4">
            <TabsTrigger value="manual" className="flex-1">
              <PenLine className="h-3.5 w-3.5 mr-1.5" />
              Basic Information
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              <FileJson className="h-3.5 w-3.5 mr-1.5" />
              AAS Import
            </TabsTrigger>
          </TabsList>

          {/* ── Manual Entry Tab ── */}
          <TabsContent value="manual" className="space-y-6">
            {/* Identification (read-only) */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Identification
              </h4>
              <div className="grid grid-cols-[140px_1fr] gap-y-3 gap-x-4 items-center rounded-md border p-4 bg-muted/30">
                <Label className="text-xs text-muted-foreground">Product ID</Label>
                <span className="text-sm font-mono">{node.productId}</span>

                {idFields.map((f) => (
                  <Fragment key={f.field}>
                    <Label className="text-xs text-muted-foreground">{f.description || fieldLabel(f.field)}</Label>
                    <span className="text-sm">
                      {(node[f.field] != null && node[f.field] !== '')
                        ? String(node[f.field])
                        : <span className="text-muted-foreground">—</span>}
                    </span>
                  </Fragment>
                ))}

                <Label className="text-xs text-muted-foreground">Material ID</Label>
                <span className="text-sm">
                  {node.materialId || <span className="text-muted-foreground">—</span>}
                </span>
              </div>
            </div>

            {/* Component Information */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Component Information
              </h4>
              <div className="space-y-4">
                {/* Material Name — editable */}
                <div className="space-y-2">
                  <Label htmlFor="materialName">Material Name</Label>
                  <Input
                    id="materialName"
                    value={materialName}
                    onChange={(e) => setMaterialName(e.target.value)}
                    placeholder="Enter material name…"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional component description…"
                    rows={3}
                  />
                </div>

                {/* Read-only fields */}
                <div className="grid grid-cols-[140px_1fr] gap-y-3 gap-x-4 items-center rounded-md border p-4 bg-muted/30">
                  <Label className="text-xs text-muted-foreground">Component Type</Label>
                  <span>
                    <Badge variant="secondary" className="text-xs">
                      {node.hasChildren === 'True' ? 'Assembly' : 'Component'}
                    </Badge>
                  </span>

                  <Label className="text-xs text-muted-foreground">Model Type</Label>
                  <span className="text-sm">{node.modelType || '—'}</span>

                  <Label className="text-xs text-muted-foreground">Weight (kg)</Label>
                  <span className="text-sm">{node.weight || '—'}</span>

                  <Label className="text-xs text-muted-foreground">Quantity</Label>
                  <span className="text-sm">{node.quantity ? String(node.quantity) : '—'}</span>
                </div>
              </div>
            </div>

            {/* IEC 81346 Reference Designation */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                IEC 81346 Reference Designation
              </h4>
              <div className="space-y-2">
                <Label htmlFor="iecClass">Class Letter</Label>
                <Select value={iecClass} onValueChange={setIecClass}>
                  <SelectTrigger id="iecClass">
                    <SelectValue placeholder="Select class letter…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(IEC_CLASS_DESCRIPTIONS).map(([letter, description]) => (
                      <SelectItem key={letter} value={letter}>
                        {letter} — {description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  IEC 81346-1:2022 / IEC 81346-2:2019
                </p>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Commit Data
              </Button>
            </div>
          </TabsContent>

          {/* ── AAS Import Tab ── */}
          <TabsContent value="import" className="space-y-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleAasFileSelect}
            />

            {!aasData ? (
              <div
                className={`flex flex-col items-center justify-center gap-4 py-12 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                  dragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <Upload className="h-10 w-10 text-muted-foreground" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">AAS Import</p>
                  <p className="text-xs text-muted-foreground">
                    Drag &amp; drop an AAS JSON file here, or click to select.
                  </p>
                </div>
                <Button variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                  <FileJson className="h-4 w-4 mr-2" />
                  Select AAS File
                </Button>
              </div>
            ) : (
              <div className="space-y-5">
                {/* File info */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-300 font-medium">{aasFileName}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace
                  </Button>
                </div>

                {/* Nameplate Preview */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Nameplate
                  </h4>
                  <div className="grid grid-cols-[200px_1fr] gap-y-2 gap-x-3 items-baseline rounded-md border p-4 bg-muted/30 text-sm">
                    <span className="text-xs text-muted-foreground">URI of the Product</span>
                    <span className="font-mono text-xs break-all">{aasData.uriOfTheProduct || '—'}</span>
                    <span className="text-xs text-muted-foreground">Manufacturer Name</span>
                    <span>{aasData.manufacturerName || '—'}</span>
                    <span className="text-xs text-muted-foreground">Product Designation</span>
                    <span>{aasData.manufacturerProductDesignation || '—'}</span>
                    <span className="text-xs text-muted-foreground">Product Type</span>
                    <span>{aasData.manufacturerProductType || '—'}</span>
                    <span className="text-xs text-muted-foreground">Article Number</span>
                    <span className="font-mono">{aasData.productArticleNumberOfManufacturer || '—'}</span>
                  </div>
                </div>

                {/* Technical Data Preview */}
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Technical Data — Product Classification
                  </h4>
                  <div className="grid grid-cols-[200px_1fr] gap-y-2 gap-x-3 items-baseline rounded-md border p-4 bg-muted/30 text-sm">
                    <span className="text-xs text-muted-foreground">Classification System</span>
                    <span>{aasData.classificationSystem || '—'}</span>
                    <span className="text-xs text-muted-foreground">System Version</span>
                    <span>{aasData.classificationSystemVersion || '—'}</span>
                    <span className="text-xs text-muted-foreground">Product Class ID</span>
                    <span className="font-mono text-xs break-all">{aasData.productClassId || '—'}</span>
                    <span className="text-xs text-muted-foreground">Coded Name</span>
                    <span className="font-mono">{aasData.productClassCodedName || '—'}</span>
                    <span className="text-xs text-muted-foreground">Class Name</span>
                    <span>{aasData.productClassName || '—'}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Technical Data — Identification
                  </h4>
                  <div className="grid grid-cols-[200px_1fr] gap-y-2 gap-x-3 items-baseline rounded-md border p-4 bg-muted/30 text-sm">
                    <span className="text-xs text-muted-foreground">Net Weight (kg)</span>
                    <span>{aasData.netWeight || '—'}</span>
                    <span className="text-xs text-muted-foreground">URI of Manufacturer</span>
                    <span className="font-mono text-xs break-all">{aasData.uriOfManufacturer || '—'}</span>
                    <span className="text-xs text-muted-foreground">GLN of Manufacturer</span>
                    <span className="font-mono">{aasData.glnOfManufacturer || '—'}</span>
                    <span className="text-xs text-muted-foreground">URI of the Product</span>
                    <span className="font-mono text-xs break-all">{aasData.uriOfTheProductTechnical || '—'}</span>
                    <span className="text-xs text-muted-foreground">Internal Article Number</span>
                    <span className="font-mono">{aasData.internalArticleNumber || '—'}</span>
                    <span className="text-xs text-muted-foreground">GTIN / EAN Code</span>
                    <span className="font-mono">{aasData.gtinEanCode || '—'}</span>
                  </div>
                </div>

                {/* Commit Button */}
                <div className="flex justify-end pt-4 border-t">
                  <Button onClick={handleAasCommit} disabled={aasCommitting}>
                    {aasCommitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Commit Data
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
