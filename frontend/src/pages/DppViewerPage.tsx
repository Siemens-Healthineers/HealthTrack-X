/**
 * DPP Viewer — Standalone Digital Product Passport page.
 * Accessed via QR code from the Finished Product side panel.
 * Shows Identification, Material Name, Weight, and IEC 81346 Reference Designation.
 * No app sidebar/navbar — meant for external sharing.
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch } from '../config/api';
import { fetchRepoMetadata } from '../contexts/AppProfileContext';
import { identifierFields, fieldLabel, type SchemaField } from '../hooks/useSchemaFields';
import type { BomNode } from '../components/BomTreeTable';
import {
  getIecClass,
  buildRdsProduct,
  computeIecNumbers,
  IEC_CLASS_DESCRIPTIONS,
} from '../lib/iec81346';

type Status = 'loading' | 'ok' | 'error';

export function DppViewerPage() {
  const { configId, folder, productId } = useParams<{
    configId: string;
    folder: string;
    productId: string;
  }>();

  const [allNodes, setAllNodes] = useState<BomNode[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  // Identifier fields derived from the data-repo schema (not hard-coded)
  const [idFields, setIdFields] = useState<SchemaField[]>([]);

  useEffect(() => {
    if (!configId || !folder) return;
    let cancelled = false;
    fetchRepoMetadata()
      .then((data) => {
        if (cancelled || !data) return;
        const repo = data.repos.find((r) => r.config_id === configId);
        const df = repo?.data_folders.find((f) => f.folder === folder) ?? repo?.data_folders[0];
        const fields = (df?.sample_fields ?? []) as unknown as SchemaField[];
        setIdFields(identifierFields(fields));
      })
      .catch(() => { /* schema unavailable — identification falls back to Product/Material ID */ });
    return () => { cancelled = true; };
  }, [configId, folder]);

  useEffect(() => {
    if (!configId || !folder || !productId) {
      setStatus('error');
      return;
    }
    const params = new URLSearchParams({ config_id: configId, folder });
    apiFetch(`/api/list-products?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setAllNodes(json.data as BomNode[]);
          setStatus('ok');
        } else {
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'));
  }, [configId, folder, productId]);

  const nodeById = useMemo(() => {
    const m = new Map<string, BomNode>();
    for (const n of allNodes) m.set(n.nodeId || n.productId, n);
    return m;
  }, [allNodes]);

  const iecNumbers = useMemo(() => computeIecNumbers(allNodes), [allNodes]);

  const node = useMemo(
    () => allNodes.find((n) => n.productId === productId || n.nodeId === productId),
    [allNodes, productId],
  );

  // Detect dark mode from system preference
  const [isDark, setIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  if (status === 'loading') {
    return (
      <Shell isDark={isDark}>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      </Shell>
    );
  }

  if (status === 'error' || !node) {
    return (
      <Shell isDark={isDark}>
        <div className="text-center py-20 text-gray-500 dark:text-gray-400">
          <p className="text-lg font-medium">Product not found</p>
          <p className="text-sm mt-1">The requested product passport could not be loaded.</p>
        </div>
      </Shell>
    );
  }

  const iecClass = getIecClass(node);
  const rds = buildRdsProduct(node, nodeById, iecNumbers);

  return (
    <Shell isDark={isDark}>
      {/* Product Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white truncate" title={node.name}>
          {node.name}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-0.5">
          {node.nodeId || node.productId}
        </p>
      </div>

      {/* Identification */}
      <Section title="Identification">
        <Field label="Product ID" mono>{node.productId}</Field>
        {idFields.map((f) => (
          <Field key={f.field} label={f.description || fieldLabel(f.field)}>
            {(node[f.field] != null && node[f.field] !== '') ? String(node[f.field]) : undefined}
          </Field>
        ))}
        <Field label="Material ID">{node.materialId}</Field>
      </Section>

      {/* Material & Weight */}
      <Section title="Material & Weight">
        <Field label="Material Name">{node.materialName}</Field>
        <Field label="Weight (kg)">{node.weight}</Field>
      </Section>

      {/* IEC 81346 Reference Designation */}
      <Section title="IEC 81346 Reference Designation">
        <Field label="Class Letter">
          <span className="inline-flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 text-xs font-mono font-medium">
              {iecClass}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {IEC_CLASS_DESCRIPTIONS[iecClass] ?? 'Unknown'}
            </span>
          </span>
        </Field>
        <Field label="RDS Product" mono>{rds}</Field>
        <Field label="Standard">IEC 81346-1:2022 / IEC 81346-2:2019</Field>
      </Section>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-gray-200 dark:border-gray-700 text-center">
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          Generated by HealthTrack-X &middot; Digital Product Passport
        </p>
      </div>
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────────

function Shell({ children, isDark }: { children: React.ReactNode; isDark: boolean }) {
  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center px-4 py-8">
        {/* Branding */}
        <div className="mb-6 text-center">
          <h1 className="text-sm font-bold tracking-widest uppercase text-blue-600 dark:text-blue-400">
            HealthTrack-X
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Digital Product Passport
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Section & Field helpers ───────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-[120px_1fr] gap-y-2 gap-x-3 items-baseline">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {label}
      </span>
      <span className={`text-sm text-gray-900 dark:text-gray-100 break-all ${mono ? 'font-mono' : ''}`}>
        {children || <span className="text-gray-400 dark:text-gray-600">—</span>}
      </span>
    </>
  );
}
