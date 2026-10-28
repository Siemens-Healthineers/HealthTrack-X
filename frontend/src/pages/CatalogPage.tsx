/**
 * CatalogPage – Schema Catalog Service
 *
 * Displays all schema fields from all configured repositories in a
 * searchable, sortable table. Shows field name, type, source,
 * description, constraints, and the originating repository.
 */

import { useState, useEffect, useMemo } from 'react';
import { Search, BookOpen, ExternalLink, ArrowUpDown, Filter, X, RefreshCw, Layers, List, ChevronDown, Sparkles, Tag, Cpu, Download } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { fieldLabel } from '../hooks/useSchemaFields';
import { apiFetch } from '../config/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CatalogEntry {
  field: string;
  type: string;
  source: 'schema' | 'rule-based' | 'ai-generated';
  description?: string;
  example?: string;
  unit?: string;
  format?: string;
  pattern?: string;
  possible_values?: string[];
  ge?: number;
  le?: number;
  min_length?: number;
  max_length?: number;
  repoFullName: string;
  repoDescription: string;
  dataFolder: string;
  section?: string;
  subsection?: string;
  repos?: string[];          // present in deduplicated view
}

interface RepoMeta {
  config_id?: string;
  full_name: string;
  data_folders: Array<{
    folder: string;
    path: string;
    section?: string;
    subsection?: string;
    sample_fields: Array<Record<string, unknown>>;
  }>;
  repository?: { full_name: string; description?: string };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type SortKey = 'field' | 'type' | 'source' | 'repoFullName';
type SortDir = 'asc' | 'desc';

function constraintSummary(entry: CatalogEntry): string {
  const parts: string[] = [];
  if (entry.unit) parts.push(`Unit: ${entry.unit}`);
  if (entry.ge !== undefined) parts.push(`≥ ${entry.ge}`);
  if (entry.le !== undefined) parts.push(`≤ ${entry.le}`);
  if (entry.min_length !== undefined) parts.push(`min ${entry.min_length} chars`);
  if (entry.max_length !== undefined) parts.push(`max ${entry.max_length} chars`);
  if (entry.format) parts.push(`Format: ${entry.format}`);
  if (entry.pattern) parts.push(`Pattern`);
  if (entry.possible_values?.length) parts.push(`${entry.possible_values.length} allowed values`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CatalogPage() {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('field');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deduplicated, setDeduplicated] = useState(true);

  // ── Fetch all repo metadata ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const res = await apiFetch('/api/repo-metadata');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const repos: RepoMeta[] = data.repos ?? [];
        const flat: CatalogEntry[] = [];

        for (const repo of repos) {
          for (const df of repo.data_folders) {
            for (const sf of df.sample_fields) {
              flat.push({
                ...(sf as Omit<CatalogEntry, 'repoFullName' | 'repoDescription' | 'dataFolder'>),
                repoFullName: repo.full_name ?? repo.repository?.full_name ?? '–',
                repoDescription: repo.repository?.description ?? '',
                dataFolder: df.folder,
                section: df.section,
                subsection: df.subsection,
              });
            }
          }
        }

        if (!cancelled) {
          setEntries(flat);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load catalog');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // ── Unique sources & repos for filter chips (single pass) ──────────────
  const { uniqueSources, uniqueRepos } = useMemo(() => {
    const sources = new Set<string>();
    const repos = new Set<string>();
    for (const e of entries) {
      sources.add(e.source);
      repos.add(e.repoFullName);
    }
    return {
      uniqueSources: [...sources].sort(),
      uniqueRepos: [...repos].sort(),
    };
  }, [entries]);

  // ── Deduplicated view ───────────────────────────────────────────
  const deduplicatedEntries = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    for (const e of entries) {
      const existing = map.get(e.field);
      if (existing) {
        if (!existing.repos!.includes(e.repoFullName)) existing.repos!.push(e.repoFullName);
      } else {
        map.set(e.field, { ...e, repos: [e.repoFullName] });
      }
    }
    return [...map.values()];
  }, [entries]);

  // ── Filtering + Sorting ─────────────────────────────────────────
  const filtered = useMemo(() => {
    const base = deduplicated ? deduplicatedEntries : entries;
    let result = base as CatalogEntry[];

    if (sourceFilter) {
      result = result.filter((e) => e.source === sourceFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => {
        const repos = e.repos ? e.repos.join(' ') : e.repoFullName;
        return [e.field, fieldLabel(e.field), e.type, e.source,
          e.description ?? '', e.example ?? '', e.unit ?? '',
          repos, e.section ?? '', e.format ?? '',
          ...(e.possible_values ?? [])].join(' ').toLowerCase().includes(q);
      });
    }

    return [...result].sort((a, b) => {
      const aVal = (sortKey === 'repoFullName'
        ? (a.repos ? a.repos.join(', ') : a.repoFullName)
        : (a[sortKey] ?? '')).toLowerCase();
      const bVal = (sortKey === 'repoFullName'
        ? (b.repos ? b.repos.join(', ') : b.repoFullName)
        : (b[sortKey] ?? '')).toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [entries, deduplicatedEntries, deduplicated, search, sourceFilter, sortKey, sortDir]);

  // ── Sort handler ────────────────────────────────────────────────
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortButton({ col, children }: { col: SortKey; children: React.ReactNode }) {
    return (
      <button
        onClick={() => toggleSort(col)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {children}
        <ArrowUpDown className={`h-3.5 w-3.5 ${sortKey === col ? 'text-foreground' : 'text-muted-foreground/50'}`} />
      </button>
    );
  }

  // ── Row key helper ──────────────────────────────────────────────
  function rowKey(e: CatalogEntry) {
    return e.repos ? `dedup|${e.field}` : `${e.repoFullName}|${e.dataFolder}|${e.field}`;
  }

  // ── Render ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading catalog…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-2 text-center max-w-md">
          <BookOpen className="h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">Catalog unavailable</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex-none px-6 py-4 space-y-4 border-b bg-background">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Title + subtitle */}
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">Catalog</h1>
            </div>
            <span className="text-sm text-muted-foreground">
              {deduplicated ? deduplicatedEntries.length : entries.length} fields across {uniqueRepos.length} {uniqueRepos.length === 1 ? 'repository' : 'repositories'}
            </span>
          </div>

          {/* Center: Search */}
          <div className="relative flex-1 max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields, types, descriptions…"
              className="w-full h-9 pl-9 pr-9 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Right: Export + Refresh */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                try {
                  const res = await apiFetch('/api/catalog-export');
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'catalog-export.xlsx';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.error('Export failed:', e);
                }
              }}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Download className="h-4 w-4" />
              Excel
            </button>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={() => setSourceFilter(null)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
              !sourceFilter
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            All
          </button>
          {uniqueSources.map((s) => {
            const isActive = sourceFilter === s;
            const icon = s === 'schema'
              ? <Tag className={`h-3 w-3 ${isActive ? '' : 'text-amber-500'}`} />
              : s === 'rule-based'
              ? <Cpu className={`h-3 w-3 ${isActive ? '' : 'text-violet-500'}`} />
              : <Sparkles className={`h-3 w-3 ${isActive ? '' : 'text-sky-500'}`} />;
            const label = s === 'ai-generated' ? 'AI-based' : s;
            return (
              <button
                key={s}
                onClick={() => setSourceFilter(isActive ? null : s)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-muted'
                }`}
              >
                {icon}
                {label}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {deduplicated ? deduplicatedEntries.length : entries.length} fields
          </span>

          {/* View mode dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border border-border hover:bg-muted text-muted-foreground"
              >
                {deduplicated ? <Layers className="h-3 w-3" /> : <List className="h-3 w-3" />}
                {deduplicated ? 'Deduplicated' : 'All entries'}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>View mode</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={deduplicated ? 'dedup' : 'all'}
                onValueChange={(v) => setDeduplicated(v === 'dedup')}
              >
                <DropdownMenuRadioItem value="dedup">
                  <Layers className="h-3.5 w-3.5 mr-2" />
                  Deduplicated
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="all">
                  <List className="h-3.5 w-3.5 mr-2" />
                  All entries
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">
                <SortButton col="field">Field</SortButton>
              </TableHead>
              <TableHead className="w-[90px]">
                <SortButton col="type">Type</SortButton>
              </TableHead>
              <TableHead className="w-[140px]">
                <SortButton col="source">Source</SortButton>
              </TableHead>
              <TableHead className="min-w-[250px]">Description</TableHead>
              <TableHead className="w-[180px]">Constraints</TableHead>
              <TableHead className="w-[240px]">
                <SortButton col="repoFullName">{deduplicated ? 'Repositories' : 'Repository'}</SortButton>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {search || sourceFilter
                    ? 'No fields match your search or filter.'
                    : 'No schema fields found.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => {
                const key = rowKey(entry);
                const isExpanded = expandedRow === key;
                return (
                  <TableRow
                    key={key}
                    className="cursor-pointer"
                    onClick={() => setExpandedRow(isExpanded ? null : key)}
                  >
                    {/* Field */}
                    <TableCell className="font-medium">
                      <span className="text-foreground">{fieldLabel(entry.field)}</span>
                      <span className="block text-xs text-muted-foreground font-mono">{entry.field}</span>
                    </TableCell>

                    {/* Type */}
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {entry.type}
                      </code>
                    </TableCell>

                    {/* Source */}
                    <TableCell>
                      <Badge variant="outline" className="gap-1">
                        {entry.source === 'ai-generated'
                          ? <><Sparkles className="h-3 w-3 text-sky-500" />AI-based</>
                          : entry.source === 'rule-based'
                          ? <><Cpu className="h-3 w-3 text-violet-500" />rule-based</>
                          : <><Tag className="h-3 w-3 text-amber-500" />schema</>}
                      </Badge>
                    </TableCell>

                    {/* Description */}
                    <TableCell className="text-sm text-muted-foreground">
                      {entry.description || '–'}
                      {isExpanded && (
                        <div className="mt-2 space-y-1 text-xs border-t pt-2">
                          {entry.example && <div><span className="font-medium text-foreground">Example:</span> {entry.example}</div>}
                          {entry.possible_values && entry.possible_values.length > 0 && (
                            <div><span className="font-medium text-foreground">Allowed:</span> {entry.possible_values.join(', ')}</div>
                          )}
                          {entry.pattern && <div><span className="font-medium text-foreground">Pattern:</span> <code className="bg-muted px-1 rounded">{entry.pattern}</code></div>}
                          {entry.section && <div><span className="font-medium text-foreground">Section:</span> {entry.section}{entry.subsection ? ` → ${entry.subsection}` : ''}</div>}
                        </div>
                      )}
                    </TableCell>

                    {/* Constraints */}
                    <TableCell className="text-xs text-muted-foreground">
                      {constraintSummary(entry) || '–'}
                    </TableCell>

                    {/* Repository */}
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm text-foreground truncate">
                          {entry.repos && entry.repos.length > 1
                            ? `${entry.repos.length} repos`
                            : entry.repoFullName.split('/').pop()}
                        </span>
                      </div>
                      {isExpanded && entry.repos && entry.repos.length > 1 && (
                        <div className="mt-2 space-y-1 text-xs border-t pt-2">
                          {entry.repos.map((repo) => (
                            <div key={repo} className="text-muted-foreground truncate">{repo}</div>
                          ))}
                        </div>
                      )}
                      {isExpanded && (!entry.repos || entry.repos.length <= 1) && (
                        <div className="mt-1 text-xs text-muted-foreground truncate">{entry.repoFullName}</div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
