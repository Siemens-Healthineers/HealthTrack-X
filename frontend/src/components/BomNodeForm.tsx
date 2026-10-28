/**
 * BomNodeForm — form for adding / editing a BOM node.
 *
 * Fields: name, parentId (dropdown), modelType (select), quantity,
 * valueType (conditional), propertyValue (conditional), description.
 * Submits via the existing NATS async write pipeline.
 */

import { useState, useEffect, useMemo } from 'react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useToast } from './ui/use-toast';
import { Loader2 } from 'lucide-react';
import { useSystemStatus } from '../contexts/SystemStatusContext';
import { useAppProfile } from '../contexts/AppProfileContext';
import { useSchemaFields, type SchemaField } from '../hooks/useSchemaFields';
import { apiFetch } from '../config/api';

export interface BomFormData {
  productId: string;
  nodeId?: string;
  name: string;
  parentId: string;
  modelType: string;
  quantity: string;
  manufacturer: string;
  materialName: string;
  weight: string;
  valueType: string;
  propertyValue: string;
  description: string;
  edcAssetId: string;
  edcAssetName: string;
  githubUrl?: string;
  githubRawUrl?: string;
}

interface BomNodeFormProps {
  editData?: BomFormData | null;
  /** Pre-set parent (from "Add Child" action) */
  defaultParentId?: string | null;
  /** Pre-filled EDC asset data (from "Add EDC Asset" action) */
  defaultEdcAsset?: { assetId: string; name: string } | null;
  /** Existing nodes for parent dropdown */
  existingNodes: Array<{ nodeId?: string; productId: string; name: string }>;
  onSuccess?: (savedData: BomFormData) => void;
}

const FALLBACK_MODEL_TYPES = [
  'Assembly',
  'Property',
  'Blob',
  'File',
  'ReferenceElement',
  'Range',
  'MultiLanguageProperty',
  'Entity',
];

const FALLBACK_VALUE_TYPES = [
  'xs:string',
  'xs:int',
  'xs:float',
  'xs:double',
  'xs:boolean',
  'xs:date',
  'xs:dateTime',
];

/** Extract possible_values for a field from schema, with fallback */
function getFieldOptions(schemaFields: SchemaField[], fieldName: string, fallback: string[]): string[] {
  const field = schemaFields.find((f) => f.field === fieldName);
  if (field?.possible_values && field.possible_values.length > 0) {
    return field.possible_values;
  }
  return fallback;
}

/** Determine the "assembly" type from modelType possible_values (first entry) or fallback */
function getAssemblyType(modelTypes: string[]): string {
  // The first entry in modelType options is the assembly/collection type
  return modelTypes[0] || 'Assembly';
}

function emptyForm(assemblyType: string): BomFormData {
  return {
    productId: '',
    name: '',
    parentId: '',
    modelType: assemblyType,
    quantity: '1',
    manufacturer: '',
    materialName: '',
    weight: '',
    valueType: '',
    propertyValue: '',
    description: '',
    edcAssetId: '',
    edcAssetName: '',
  };
}

export function BomNodeForm({
  editData,
  defaultParentId,
  defaultEdcAsset,
  existingNodes,
  onSuccess,
}: BomNodeFormProps) {
  const { toast } = useToast();
  const { status: systemStatus } = useSystemStatus();
  const { configId, dataFolder } = useAppProfile();
  const { schemaFields } = useSchemaFields();

  // Derive MODEL_TYPES and VALUE_TYPES from metadata, with fallbacks
  const MODEL_TYPES = useMemo(
    () => getFieldOptions(schemaFields, 'modelType', FALLBACK_MODEL_TYPES),
    [schemaFields],
  );
  const VALUE_TYPES = useMemo(
    () => getFieldOptions(schemaFields, 'valueType', FALLBACK_VALUE_TYPES),
    [schemaFields],
  );
  const assemblyType = useMemo(() => getAssemblyType(MODEL_TYPES), [MODEL_TYPES]);

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<BomFormData>(() => {
    if (editData) return { ...editData };
    const f = emptyForm(assemblyType);
    if (defaultParentId) f.parentId = defaultParentId;
    if (defaultEdcAsset) {
      f.edcAssetId = defaultEdcAsset.assetId;
      f.edcAssetName = defaultEdcAsset.name;
      f.name = defaultEdcAsset.name;
      // Derive productId from EDC asset ID: "htx-product-{originalProductId}" → originalProductId
      const prefix = 'htx-product-';
      if (defaultEdcAsset.assetId.startsWith(prefix)) {
        f.productId = defaultEdcAsset.assetId.slice(prefix.length);
      }
    }
    return f;
  });

  useEffect(() => {
    if (editData) {
      setFormData({ ...editData });
    } else {
      const f = emptyForm(assemblyType);
      if (defaultParentId) f.parentId = defaultParentId;
      if (defaultEdcAsset) {
        f.edcAssetId = defaultEdcAsset.assetId;
        f.edcAssetName = defaultEdcAsset.name;
        f.name = defaultEdcAsset.name;
        const prefix = 'htx-product-';
        if (defaultEdcAsset.assetId.startsWith(prefix)) {
          f.productId = defaultEdcAsset.assetId.slice(prefix.length);
        }
      }
      setFormData(f);
    }
  }, [editData, defaultParentId, defaultEdcAsset, assemblyType]);

  const handleChange = (field: keyof BomFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // ── Async job polling ───────────────────────────────────────
  const pollJobStatus = async (jobId: string, snapshot: BomFormData): Promise<BomFormData> => {
    const maxAttempts = 30;
    const pollInterval = 1000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const res = await apiFetch(`/api/job-status/${jobId}`);
      if (!res.ok) throw new Error('Failed to check job status');
      const status = await res.json();

      if (status.status === 'completed') {
        return {
          ...snapshot,
          productId: status.product_id,
          githubUrl: status.github_url,
          githubRawUrl: status.github_raw_url,
        };
      } else if (status.status === 'failed') {
        throw new Error(status.error_message || 'Processing failed');
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, pollInterval));
      }
    }
    throw new Error('Polling timeout');
  };

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (systemStatus.backend.status === 'offline') {
      toast({ title: 'Backend offline', description: 'Please start the container or Kubernetes stack', variant: 'destructive' });
      return;
    }

    if (!formData.name.trim()) {
      toast({ title: 'Validation', description: 'Name is required', variant: 'destructive' });
      return;
    }

    setLoading(true);

    try {
      const tempProductId = editData?.productId || `temp-${Date.now()}`;

      // Build payload — all fields as flat key-value pairs
      const dataPayload: Record<string, string> = {
        productId: editData ? formData.productId : '',
        nodeId: formData.nodeId || '',
        name: formData.name,
        parentId: formData.parentId || '',
        modelType: formData.modelType,
        quantity: formData.quantity || '1',
        manufacturer: formData.manufacturer || '',
        materialName: formData.materialName || '',
        weight: formData.weight || '',
        valueType: formData.valueType || '',
        propertyValue: formData.propertyValue || '',
        description: formData.description || '',
        edcAssetId: formData.edcAssetId || '',
        edcAssetName: formData.edcAssetName || '',
      };

      const folder = dataFolder || 'bom';
      const requestData: Record<string, unknown> = {
        file_path: `data/${folder}/`,
        data: dataPayload,
      };
      if (configId) requestData.config_id = configId;

      const asyncResponse = await apiFetch('/api/write-json-async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      });

      if (asyncResponse.ok) {
        const result = await asyncResponse.json();
        const realProductId = result.productId || tempProductId;

        const optimistic: BomFormData = {
          ...formData,
          productId: realProductId,
          githubUrl: 'pending',
          githubRawUrl: 'pending',
        };

        if (!editData) {
          const existing = JSON.parse(sessionStorage.getItem('optimisticProducts') || '[]');
          existing.push({ ...optimistic, _jobId: result.job_id, _timestamp: Date.now() });
          sessionStorage.setItem('optimisticProducts', JSON.stringify(existing));
        }

        toast({
          title: 'Saved',
          description: editData
            ? 'Changes saved — syncing to GitHub...'
            : 'BOM node created — syncing in background',
        });

        if (onSuccess) onSuccess(optimistic);
        // Snapshot form data BEFORE resetting — polling needs it for the final callback
        const formSnapshot = { ...formData, productId: realProductId };
        setFormData(emptyForm(assemblyType));
        setLoading(false);

        // Background polling
        pollJobStatus(result.job_id, formSnapshot)
          .then((finalData) => {
            if (!editData) {
              const updated = JSON.parse(sessionStorage.getItem('optimisticProducts') || '[]')
                .filter((item: Record<string, unknown>) => item._jobId !== result.job_id);
              sessionStorage.setItem('optimisticProducts', JSON.stringify(updated));
              // Only trigger auto-refresh for NEW nodes (need real productId from server)
              sessionStorage.setItem('jobJustCompleted', Date.now().toString());
            }
            if (onSuccess) onSuccess(finalData);
          })
          .catch(() => {
            sessionStorage.setItem('dataInvalidated', Date.now().toString());
            sessionStorage.removeItem('optimisticProducts');
          });

        return;
      }

      const error = await asyncResponse.json().catch(() => ({ detail: asyncResponse.statusText }));
      throw new Error(error.detail || 'Failed to submit data');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const isProperty = formData.modelType === 'Property';

  // Parent node options — exclude self and own descendants to prevent circular refs
  const parentOptions = useMemo(() => {
    if (!editData?.productId) return existingNodes;
    const selfId = editData.nodeId || editData.productId;
    // Collect all descendant IDs
    const descendants = new Set<string>();
    function collectChildren(parentId: string) {
      for (const n of existingNodes) {
        const nParent = (n as Record<string, unknown>).parentId as string | undefined;
        const nId = n.nodeId || n.productId;
        if (nParent === parentId && !descendants.has(nId)) {
          descendants.add(nId);
          collectChildren(nId);
        }
      }
    }
    descendants.add(selfId);
    collectChildren(selfId);
    return existingNodes.filter((n) => !descendants.has(n.nodeId || n.productId));
  }, [existingNodes, editData]);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="bom-name">Name *</Label>
        <Input
          id="bom-name"
          placeholder="e.g. Implant Housing"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          required
        />
      </div>

      {/* Parent Node */}
      <div className="space-y-2">
        <Label htmlFor="bom-parent">Parent Node</Label>
        <Select
          value={formData.parentId || '_none'}
          onValueChange={(v) => handleChange('parentId', v === '_none' ? '' : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="(Root — no parent)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">(Root — no parent)</SelectItem>
            {parentOptions.map((n) => {
              const id = n.nodeId || n.productId;
              return (
                <SelectItem key={id} value={id}>
                  {n.name || id}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Model Type */}
      <div className="space-y-2">
        <Label htmlFor="bom-modelType">Model Type</Label>
        <Select
          value={formData.modelType}
          onValueChange={(v) => handleChange('modelType', v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Quantity */}
      <div className="space-y-2">
        <Label htmlFor="bom-quantity">Quantity</Label>
        <Input
          id="bom-quantity"
          type="number"
          min={1}
          placeholder="1"
          value={formData.quantity}
          onChange={(e) => handleChange('quantity', e.target.value)}
        />
      </div>

      {/* Conditional: Value Type (only for Property) */}
      {isProperty && (
        <div className="space-y-2">
          <Label htmlFor="bom-valueType">Value Type</Label>
          <Select
            value={formData.valueType || 'xs:string'}
            onValueChange={(v) => handleChange('valueType', v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Conditional: Property Value (only for Property) */}
      {isProperty && (
        <div className="space-y-2">
          <Label htmlFor="bom-propertyValue">Value</Label>
          <Input
            id="bom-propertyValue"
            placeholder="e.g. Titanium Grade 5"
            value={formData.propertyValue}
            onChange={(e) => handleChange('propertyValue', e.target.value)}
          />
        </div>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="bom-desc">Description</Label>
        <Textarea
          id="bom-desc"
          placeholder="Optional description"
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          rows={2}
        />
      </div>

      {/* Manufacturer */}
      <div className="space-y-2">
        <Label htmlFor="bom-manufacturer">Manufacturer</Label>
        <Input
          id="bom-manufacturer"
          placeholder="e.g. Zimmer Biomet"
          value={formData.manufacturer}
          onChange={(e) => handleChange('manufacturer', e.target.value)}
        />
      </div>

      {/* Material Name (not for assembly type) */}
      {formData.modelType !== assemblyType && (
        <div className="space-y-2">
          <Label htmlFor="bom-materialName">Material Name</Label>
          <Input
            id="bom-materialName"
            placeholder="e.g. CoCrMo (ASTM F75)"
            value={formData.materialName}
            onChange={(e) => handleChange('materialName', e.target.value)}
          />
        </div>
      )}

      {/* Weight (not for assembly type) */}
      {formData.modelType !== assemblyType && (
        <div className="space-y-2">
          <Label htmlFor="bom-weight">Weight (g)</Label>
          <Input
            id="bom-weight"
            type="number"
            step="0.1"
            min={0}
            placeholder="e.g. 285.0"
            value={formData.weight}
            onChange={(e) => handleChange('weight', e.target.value)}
          />
        </div>
      )}

      {/* EDC Asset fields (read-only when pre-filled) */}
      {(formData.edcAssetId || defaultEdcAsset) && (
        <div className="space-y-2 rounded-md border p-3 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground">EDC Connector Asset</p>
          <p className="text-sm">{formData.edcAssetName || formData.edcAssetId}</p>
          <p className="text-xs font-mono text-muted-foreground truncate">{formData.edcAssetId}</p>
        </div>
      )}

      {/* Submit */}
      <Button type="submit" disabled={loading} className="w-full">
        {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {editData ? 'Update BOM Node' : 'Create BOM Node'}
      </Button>
    </form>
  );
}
