/**
 * useSchemaFields – fetches YAML-driven field metadata from /api/repo-metadata
 * and exposes schema / rule-based / ai-generated field lists.
 *
 * This is the single source of truth that drives DataForm (input fields)
 * and TablePage (columns) dynamically.
 *
 * Profile-aware: uses configId + dataFolder from AppProfileContext to
 * resolve the correct repo + folder automatically.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAppProfile } from '../contexts/AppProfileContext';
import { fetchRepoMetadata, clearRepoMetadataCache } from '../contexts/AppProfileContext';

export interface SchemaField {
  field: string;          // e.g. "productName"
  type: string;           // e.g. "str", "float", "int", "bool"
  source: 'schema' | 'ai-generated' | 'rule-based';
  description?: string;
  example?: string;
  unit?: string;
  format?: string;
  possible_values?: string[];
  ge?: number;
  le?: number;
  min_length?: number;
  max_length?: number;
}

// ── Module-level cache  (keyed by "configId|folder") ────────
const _schemaCache: Map<string, SchemaField[]> = new Map();
const _schemaCacheTs: Map<string, number> = new Map();
const SCHEMA_CACHE_TTL = 120_000; // 2 minutes

function cacheKey(configId: string | null, folder: string): string {
  return `${configId ?? 'default'}|${folder}`;
}

/**
 * Hook that returns schema fields for the active profile's repo + folder.
 *
 * - `schemaFields`   → only `source === 'schema'`  (used as form inputs + table columns)
 * - `ruleBasedFields` → `source === 'rule-based'`   (productId, githubUrl, etc.)
 * - `aiFields`       → `source === 'ai-generated'`  (predictedLifecycle, riskScore, etc.)
 */
export function useSchemaFields() {
  const { configId, dataFolder, repoFullName } = useAppProfile();
  const key = cacheKey(configId, dataFolder);

  const [allFields, setAllFields] = useState<SchemaField[]>(_schemaCache.get(key) || []);
  const [loading, setLoading] = useState(!_schemaCache.has(key));
  const [error, setError] = useState<string | null>(null);

  // Track previous key to detect profile switches
  const prevKey = useRef(key);

  useEffect(() => {
    if (!configId) {
      setAllFields([]);
      setLoading(false);
      setError(null);
      return;
    }

    // If profile changed, reset state immediately
    if (prevKey.current !== key) {
      prevKey.current = key;
      const cached = _schemaCache.get(key);
      if (cached) {
        setAllFields(cached);
        setLoading(false);
        setError(null);
        return;
      }
      setAllFields([]);
      setLoading(true);
      setError(null);
    }

    const now = Date.now();
    const tsKey = _schemaCacheTs.get(key) ?? 0;
    if (_schemaCache.has(key) && now - tsKey < SCHEMA_CACHE_TTL) {
      setAllFields(_schemaCache.get(key)!);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchSchema() {
      try {
        const data = await fetchRepoMetadata();
        if (!data) throw new Error('Failed to fetch metadata');

        // Find repo matching current profile
        let repo = repoFullName
          ? data.repos.find((r) => r.full_name === repoFullName)
          : null;

        // Fallback: match by configId
        if (!repo && configId) {
          repo = data.repos.find((r) => r.config_id === configId);
        }

        if (!repo) throw new Error('No repo found in metadata');

        // Find matching data folder
        const folder = repo.data_folders.find((f) => f.folder === dataFolder);
        if (!folder) throw new Error(`${dataFolder} folder not found`);

        const fields = (folder.sample_fields ?? []) as unknown as SchemaField[];

        if (!cancelled) {
          _schemaCache.set(key, fields);
          _schemaCacheTs.set(key, Date.now());
          setAllFields(fields);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          console.warn('useSchemaFields: fallback – metadata unavailable', e);
          setError(e instanceof Error ? e.message : 'Unknown error');
          setLoading(false);
        }
      }
    }

    fetchSchema();
    return () => {
      cancelled = true;
    };
  }, [key, configId, dataFolder, repoFullName]);

  const { schemaFields, ruleBasedFields, aiFields } = useMemo(() => {
    const schema: SchemaField[] = [];
    const rules: SchemaField[] = [];
    const ai: SchemaField[] = [];
    for (const f of allFields) {
      if (f.source === 'schema') schema.push(f);
      else if (f.source === 'rule-based') rules.push(f);
      else if (f.source === 'ai-generated') ai.push(f);
    }
    return { schemaFields: schema, ruleBasedFields: rules, aiFields: ai };
  }, [allFields]);

  return { allFields, schemaFields, ruleBasedFields, aiFields, loading, error };
}

/** Invalidate the cached schema so next mount refetches */
export function invalidateSchemaCache() {
  _schemaCache.clear();
  _schemaCacheTs.clear();
  clearRepoMetadataCache();
}

// ── Shared helpers (used by DataForm AND TablePage) ─────────

/** Pretty column header from camelCase field name */
export function fieldLabel(fieldName: string): string {
  const labels: Record<string, string> = {
    productId: 'Product-ID',
    productName: 'Material Name',
    manufacturer: 'Manufacturer',
    materialName: 'Material Name',
    recycledContent: 'Recycled Content',
    co2Equivalent: 'CO₂ Equivalent',
    co2Method: 'CO₂ Method',
    materialType: 'Material Type',
    crmaStatus: 'EU CRMA',
  };
  if (labels[fieldName]) return labels[fieldName];
  // fallback: camelCase → Title Case
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/** Short unit string for column headers / cell suffixes */
export function fieldUnit(f: SchemaField): string {
  if (f.unit === '%') return '%';
  if (f.unit === 'kg CO₂e / kg') return 'kgCO₂eq';
  if (f.unit) return f.unit;
  return '';
}

// Identifier fields already rendered by dedicated, generic curated rows.
const _CURATED_ID_FIELDS = new Set(['productId', 'materialId', 'parentId', 'productClassId', 'edcAssetId']);

/**
 * Schema-derived identifier fields for the curated identification panels.
 *
 * Instead of hard-coding proprietary field names, the detail panels render
 * whatever identifier-like fields the data-repo schema declares (anything
 * ending in "Id"/"Revision") that isn't already shown by a dedicated row.
 * Labels are taken from the schema `description` so they too come from the
 * data repo rather than the app source.
 */
export function identifierFields(schemaFields: SchemaField[]): SchemaField[] {
  return schemaFields.filter(
    (f) => /(?:Id|Revision)$/.test(f.field) && !_CURATED_ID_FIELDS.has(f.field),
  );
}
