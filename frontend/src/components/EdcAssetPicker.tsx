/**
 * EdcAssetPicker — dialog content that lists EDC connector assets
 * and lets the user pick one to insert into the BOM.
 */

import { useState, useEffect } from 'react';
import { Search, Link2, Loader2, AlertTriangle } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import { Badge } from './ui/badge';
import { apiFetch } from '../config/api';

export interface EdcAssetOption {
  assetId: string;
  name: string;
  description: string;
  contentType: string;
}

interface EdcAssetPickerProps {
  onSelect: (asset: EdcAssetOption) => void;
  onCancel: () => void;
}

export function EdcAssetPicker({ onSelect, onCancel }: EdcAssetPickerProps) {
  const [assets, setAssets] = useState<EdcAssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch('/api/edc/assets-for-bom');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: EdcAssetOption[] = await res.json();
        if (!cancelled) {
          setAssets(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load EDC assets');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = search.trim()
    ? assets.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.assetId.toLowerCase().includes(search.toLowerCase()) ||
          a.description.toLowerCase().includes(search.toLowerCase()),
      )
    : assets;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading EDC assets…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm text-muted-foreground text-center">
          Could not load EDC assets. The connector may not be configured.
        </p>
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search assets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Asset list */}
      <div className="rounded-md border max-h-[360px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead className="w-[120px]">Content Type</TableHead>
              <TableHead className="w-[80px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  {assets.length === 0
                    ? 'No EDC assets available. Register products in the Connector first.'
                    : 'No assets match your search.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((asset) => (
                <TableRow key={asset.assetId} className="group">
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <Link2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{asset.name}</p>
                        {asset.description && (
                          <p className="text-xs text-muted-foreground truncate">{asset.description}</p>
                        )}
                        <p className="text-xs font-mono text-muted-foreground truncate">{asset.assetId}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {asset.contentType && (
                      <Badge variant="secondary" className="text-xs font-normal">
                        {asset.contentType}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onSelect(asset)}
                    >
                      Select
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
