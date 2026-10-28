/**
 * ConnectorPage – EDC Tractus-X Dataspace Connector
 *
 * Allows users to:
 *  - Check EDC connector status
 *  - Browse catalogs from other dataspace participants
 *  - Manage assets, policies, contract definitions
 *  - Initiate contract negotiations and data transfers
 *  - Publish local products into the dataspace
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Wifi, WifiOff, AlertCircle, Send, Upload,
  Shield, ArrowRightLeft, Search, Package, Plus, Trash2,
  Loader2, Compass, ArrowRight, Clock, CheckCircle, XCircle, Pencil, FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '../components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '../components/ui/tooltip';
import { useToast } from '../components/ui/use-toast';
import { apiJson as apiFetch } from '../config/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EdcStatus {
  status: 'online' | 'offline' | 'error' | 'not_configured' | 'checking';
  message: string;
  managementUrl: string;
  participantId: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'online':
      return <Wifi className="h-5 w-5 text-green-500" />;
    case 'offline':
      return <WifiOff className="h-5 w-5 text-red-500" />;
    case 'not_configured':
      return <AlertCircle className="h-5 w-5 text-yellow-500" />;
    case 'checking':
      return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
    default:
      return <AlertCircle className="h-5 w-5 text-red-500" />;
  }
}

function statusBadge(state: string | undefined) {
  if (!state) return <Badge variant="outline">Unknown</Badge>;
  const s = state.toUpperCase();
  if (s.includes('FINALIZED') || s.includes('COMPLETED') || s.includes('CONFIRMED'))
    return <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">{state}</Badge>;
  if (s.includes('ERROR') || s.includes('TERMINATED') || s.includes('FAILED'))
    return <Badge className="bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30">{state}</Badge>;
  if (s.includes('REQUEST') || s.includes('INITIAL') || s.includes('STARTED'))
    return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30">{state}</Badge>;
  return <Badge variant="outline">{state}</Badge>;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ConnectorPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Status
  const [edcStatus, setEdcStatus] = useState<EdcStatus>({
    status: 'checking', message: 'Checking…', managementUrl: '', participantId: '',
  });

  // Active tab
  const [activeTab, setActiveTab] = useState('discovery');

  // Catalog
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [providerUrl, setProviderUrl] = useState('');

  // Assets
  const [assets, setAssets] = useState<any[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);

  // Local registrations (works offline)
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  // Status counts derived once per registrations change (instead of
  // re-filtering the array several times on every render).
  const registrationCounts = useMemo(() => {
    let published = 0, pending = 0, deleted = 0;
    for (const r of registrations) {
      if (r.status === 'published') published++;
      else if (r.status === 'pending') pending++;
      else if (r.status === 'deleted') deleted++;
    }
    return { published, pending, deleted };
  }, [registrations]);

  // Policies
  const [policies, setPolicies] = useState<any[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    name: '',
    permission: 'use',
    purpose: '',
    credentialType: 'MembershipCredential',
    validFrom: '',
    validTo: '',
  });
  const [policyCreating, setPolicyCreating] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<any>(null);

  // Negotiations
  const [negotiations, setNegotiations] = useState<any[]>([]);
  const [negotiationsLoading, setNegotiationsLoading] = useState(false);

  // Contract Definitions
  const [contractDefs, setContractDefs] = useState<any[]>([]);
  const [contractDefsLoading, setContractDefsLoading] = useState(false);

  // Index contract definitions by id once, so per-row lookups (e.g. in the
  // negotiations table) are O(1) instead of a linear scan per row.
  const contractDefById = useMemo(() => {
    const map = new Map<string, any>();
    for (const cd of contractDefs) {
      const id = cd['@id'] || cd.id;
      if (id) map.set(id, cd);
    }
    return map;
  }, [contractDefs]);
  const [contractDialogOpen, setContractDialogOpen] = useState(false);
  const [contractForm, setContractForm] = useState({
    name: '',
    description: '',
    provider: '',
    consumer: '',
    validFrom: '',
    validTo: '',
    purpose: '',
    terms: '',
    providerEndpoint: '',
  });
  const [contractCreating, setContractCreating] = useState(false);
  const [editingContract, setEditingContract] = useState<any>(null);

  // Negotiation dialog
  const [negotiationDialogOpen, setNegotiationDialogOpen] = useState(false);
  const [negotiationForm, setNegotiationForm] = useState({
    contractId: '',
    providerUrl: '',
  });
  const [negotiationStarting, setNegotiationStarting] = useState(false);

  // Transfers
  const [transfers, setTransfers] = useState<any[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);

  // Discovery
  const [discoveryStatus, setDiscoveryStatus] = useState<any>(null);
  const [discoverySearchKey, setDiscoverySearchKey] = useState('');
  const [discoveryResourceType, setDiscoveryResourceType] = useState('manufacturerPartId');
  const [discoveryResults, setDiscoveryResults] = useState<any[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryBpnInput, setDiscoveryBpnInput] = useState('');
  const [discoveryBpnResults, setDiscoveryBpnResults] = useState<any[]>([]);

  // ------------------------------------------------------------------
  //  Status check
  // ------------------------------------------------------------------
  const checkStatus = useCallback(async () => {
    setEdcStatus(prev => ({ ...prev, status: 'checking', message: 'Checking…' }));
    try {
      const s = await apiFetch<EdcStatus>('/api/edc/status');
      setEdcStatus(s);
    } catch {
      setEdcStatus({ status: 'error', message: 'Backend unreachable', managementUrl: '', participantId: '' });
    }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  // ------------------------------------------------------------------
  //  Catalog
  // ------------------------------------------------------------------
  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const body = providerUrl ? { providerUrl } : {};
      const result = await apiFetch<any>('/api/edc/catalog', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      // EDC catalog response has datasets under dcat:dataset
      const datasets = result?.['dcat:dataset'] || result?.datasets || [];
      setCatalogItems(Array.isArray(datasets) ? datasets : [datasets]);
      toast({ title: 'Catalog loaded', description: `${(Array.isArray(datasets) ? datasets : [datasets]).length} datasets found` });
    } catch (e: any) {
      toast({ title: 'Catalog request failed', description: e.message, variant: 'destructive' });
    } finally {
      setCatalogLoading(false);
    }
  };

  // ------------------------------------------------------------------
  //  Assets
  // ------------------------------------------------------------------
  const fetchAssets = async () => {
    setAssetsLoading(true);
    try {
      const result = await apiFetch<any[]>('/api/edc/assets');
      setAssets(Array.isArray(result) ? result : []);
    } catch (e: any) {
      toast({ title: 'Assets loading failed', description: e.message, variant: 'destructive' });
    } finally {
      setAssetsLoading(false);
    }
  };

  const deleteAsset = async (id: string) => {
    try {
      await apiFetch(`/api/edc/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast({ title: 'Asset deleted' });
      fetchAssets();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  // ------------------------------------------------------------------
  //  Local Registrations
  // ------------------------------------------------------------------
  const fetchRegistrations = async (syncStatus = false) => {
    setRegistrationsLoading(true);
    try {
      if (syncStatus) {
        await apiFetch('/api/edc/registrations/sync-status', { method: 'POST' }).catch(() => {});
      }
      const result = await apiFetch<any[]>('/api/edc/registrations');
      setRegistrations(Array.isArray(result) ? result : []);
    } catch (e: any) {
      toast({ title: 'Registrations loading failed', description: e.message, variant: 'destructive' });
    } finally {
      setRegistrationsLoading(false);
    }
  };

  const deleteRegistration = async (productId: string) => {
    try {
      await apiFetch(`/api/edc/registrations/${encodeURIComponent(productId)}`, { method: 'DELETE' });
      toast({ title: 'Registration removed' });
      fetchRegistrations();
    } catch (e: any) {
      toast({ title: 'Remove failed', description: e.message, variant: 'destructive' });
    }
  };

  const syncPending = async () => {
    setSyncLoading(true);
    try {
      const result = await apiFetch<any>('/api/edc/sync', { method: 'POST' });
      toast({
        title: 'Sync complete',
        description: `${result.synced || 0} published, ${result.failed || 0} failed`,
      });
      fetchRegistrations();
    } catch (e: any) {
      toast({ title: 'Sync failed', description: e.message, variant: 'destructive' });
    } finally {
      setSyncLoading(false);
    }
  };

  // Load registrations, policies and contract definitions on mount
  useEffect(() => { fetchRegistrations(); fetchPolicies(); fetchContractDefs(); }, []);

  // ------------------------------------------------------------------
  //  Policies
  // ------------------------------------------------------------------
  const fetchPolicies = async () => {
    setPoliciesLoading(true);
    try {
      const result = await apiFetch<any[]>('/api/edc/policies');
      setPolicies(Array.isArray(result) ? result : []);
    } catch (e: any) {
      toast({ title: 'Policies loading failed', description: e.message, variant: 'destructive' });
    } finally {
      setPoliciesLoading(false);
    }
  };

  const createPolicy = async () => {
    if (!policyForm.name.trim()) {
      toast({ title: 'Policy name required', variant: 'destructive' });
      return;
    }
    setPolicyCreating(true);
    try {
      const isEdit = !!editingPolicy;
      const url = isEdit
        ? `/api/edc/policies/${encodeURIComponent(editingPolicy['@id'] || editingPolicy.id)}`
        : '/api/edc/policies';
      const method = isEdit ? 'PUT' : 'POST';

      await apiFetch(url, {
        method,
        body: JSON.stringify({
          ...(isEdit ? {} : { type: 'dcp' }),
          policyName: policyForm.name.trim(),
          permission: policyForm.permission,
          purpose: policyForm.purpose || undefined,
          credentialType: policyForm.credentialType,
          validFrom: policyForm.validFrom || undefined,
          validTo: policyForm.validTo || undefined,
        }),
      });
      toast({ title: isEdit ? 'Policy updated' : 'DCP Policy created', description: policyForm.name });
      setPolicyDialogOpen(false);
      setEditingPolicy(null);
      setPolicyForm({ name: '', permission: 'use', purpose: '', credentialType: 'MembershipCredential', validFrom: '', validTo: '' });
      fetchPolicies();
    } catch (e: any) {
      toast({ title: 'Policy operation failed', description: e.message, variant: 'destructive' });
    } finally {
      setPolicyCreating(false);
    }
  };

  const openEditPolicy = (pol: any) => {
    const perms = pol.policy?.['odrl:permission'] || [];
    const perm0 = perms[0] || {};
    const action = perm0['odrl:action'] || 'use';
    // Extract constraints
    const constraint = perm0['odrl:constraint'] || {};
    const constraintList = constraint['odrl:and'] || (constraint['odrl:leftOperand'] ? [constraint] : []);
    let purpose = '';
    let credentialType = 'MembershipCredential';
    let validFrom = '';
    let validTo = '';
    for (const c of constraintList) {
      const left = c['odrl:leftOperand'];
      const leftId = typeof left === 'object' ? left['@id'] : left;
      const right = c['odrl:rightOperand'];
      const rightVal = typeof right === 'object' ? (right['@value'] || right) : right;
      if (leftId?.includes('UsagePurpose')) purpose = String(rightVal);
      if (leftId?.includes('CredentialType')) credentialType = String(rightVal);
      if (leftId?.includes('dateTime') && c['odrl:operator']?.['@id']?.includes('gteq')) validFrom = String(rightVal);
      if (leftId?.includes('dateTime') && c['odrl:operator']?.['@id']?.includes('lteq')) validTo = String(rightVal);
    }
    setEditingPolicy(pol);
    setPolicyForm({
      name: pol.properties?.['htx:policyName'] || pol['@id'] || '',
      permission: action,
      purpose,
      credentialType,
      validFrom,
      validTo,
    });
    setPolicyDialogOpen(true);
  };

  const deletePolicy = async (policyId: string) => {
    try {
      await apiFetch(`/api/edc/policies/${encodeURIComponent(policyId)}`, { method: 'DELETE' });
      toast({ title: 'Policy deleted' });
      fetchPolicies();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  // ------------------------------------------------------------------
  //  Negotiations
  // ------------------------------------------------------------------
  const deleteNegotiation = async (negId: string) => {
    try {
      await apiFetch(`/api/edc/negotiations/${encodeURIComponent(negId)}`, { method: 'DELETE' });
      toast({ title: 'Verhandlung gelöscht' });
      fetchNegotiations();
    } catch (e: any) {
      toast({ title: 'Löschen fehlgeschlagen', description: e.message, variant: 'destructive' });
    }
  };

  const fetchNegotiations = async () => {
    setNegotiationsLoading(true);
    try {
      const result = await apiFetch<any[]>('/api/edc/negotiations');
      setNegotiations(Array.isArray(result) ? result : []);
    } catch (e: any) {
      toast({ title: 'Negotiations loading failed', description: e.message, variant: 'destructive' });
    } finally {
      setNegotiationsLoading(false);
    }
  };

  // ------------------------------------------------------------------
  //  Contract Definitions
  // ------------------------------------------------------------------
  const fetchContractDefs = async () => {
    setContractDefsLoading(true);
    try {
      const result = await apiFetch<any[]>('/api/edc/contract-definitions');
      setContractDefs(Array.isArray(result) ? result : []);
    } catch (e: any) {
      toast({ title: 'Contract definitions loading failed', description: e.message, variant: 'destructive' });
    } finally {
      setContractDefsLoading(false);
    }
  };

  const emptyContractForm = { name: '', description: '', provider: '', consumer: '', validFrom: '', validTo: '', purpose: '', terms: '', providerEndpoint: '' };

  const createOrUpdateContract = async () => {
    if (!contractForm.name.trim()) {
      toast({ title: 'Contract name is required', variant: 'destructive' });
      return;
    }
    setContractCreating(true);
    try {
      const isEdit = !!editingContract;
      const url = isEdit
        ? `/api/edc/contract-definitions/${encodeURIComponent(editingContract['@id'] || editingContract.id)}`
        : '/api/edc/contract-definitions';
      const method = isEdit ? 'PUT' : 'POST';

      await apiFetch(url, {
        method,
        body: JSON.stringify({
          contractName: contractForm.name.trim(),
          description: contractForm.description.trim() || undefined,
          provider: contractForm.provider.trim() || undefined,
          consumer: contractForm.consumer.trim() || undefined,
          validFrom: contractForm.validFrom || undefined,
          validTo: contractForm.validTo || undefined,
          purpose: contractForm.purpose || undefined,
          terms: contractForm.terms.trim() || undefined,
          providerEndpoint: contractForm.providerEndpoint.trim() || undefined,
        }),
      });
      toast({ title: isEdit ? 'Contract updated' : 'Contract definition created' });
      setContractDialogOpen(false);
      setEditingContract(null);
      setContractForm(emptyContractForm);
      fetchContractDefs();
    } catch (e: any) {
      toast({ title: 'Contract operation failed', description: e.message, variant: 'destructive' });
    } finally {
      setContractCreating(false);
    }
  };

  const openEditContract = (cd: any) => {
    const props = cd.properties || {};
    setEditingContract(cd);
    setContractForm({
      name: props['htx:contractName'] || '',
      description: props['htx:description'] || '',
      provider: props['htx:provider'] || '',
      consumer: props['htx:consumer'] || '',
      validFrom: props['htx:validFrom'] || '',
      validTo: props['htx:validTo'] || '',
      purpose: props['htx:purpose'] || '',
      terms: props['htx:terms'] || '',
      providerEndpoint: props['htx:providerEndpoint'] || '',
    });
    setContractDialogOpen(true);
  };

  const deleteContractDef = async (cdId: string) => {
    try {
      await apiFetch(`/api/edc/contract-definitions/${encodeURIComponent(cdId)}`, { method: 'DELETE' });
      toast({ title: 'Contract definition deleted' });
      fetchContractDefs();
    } catch (e: any) {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' });
    }
  };

  const startNegotiation = async () => {
    if (!negotiationForm.contractId || !negotiationForm.providerUrl) {
      toast({ title: 'Contract and Provider Endpoint are required', variant: 'destructive' });
      return;
    }
    setNegotiationStarting(true);
    try {
      await apiFetch('/api/edc/negotiations', {
        method: 'POST',
        body: JSON.stringify({
          contractDefinitionId: negotiationForm.contractId,
          providerUrl: negotiationForm.providerUrl,
        }),
      });
      toast({ title: 'Negotiation started' });
      setNegotiationDialogOpen(false);
      setNegotiationForm({ contractId: '', providerUrl: '' });
      fetchNegotiations();
    } catch (e: any) {
      toast({ title: 'Negotiation failed', description: e.message, variant: 'destructive' });
    } finally {
      setNegotiationStarting(false);
    }
  };

  // ------------------------------------------------------------------
  //  Transfers
  // ------------------------------------------------------------------
  const fetchTransfers = async () => {
    setTransfersLoading(true);
    try {
      const result = await apiFetch<any[]>('/api/edc/transfers');
      setTransfers(Array.isArray(result) ? result : []);
    } catch (e: any) {
      toast({ title: 'Transfers loading failed', description: e.message, variant: 'destructive' });
    } finally {
      setTransfersLoading(false);
    }
  };

  // ------------------------------------------------------------------
  //  Discovery Services
  // ------------------------------------------------------------------
  const fetchDiscoveryStatus = async () => {
    try {
      const s = await apiFetch<any>('/api/edc/discovery/status');
      setDiscoveryStatus(s);
    } catch {
      setDiscoveryStatus(null);
    }
  };

  const resolveEndpoints = async () => {
    if (!discoverySearchKey.trim()) return;
    setDiscoveryLoading(true);
    setDiscoveryResults([]);
    try {
      const result = await apiFetch<any[]>('/api/edc/discovery/resolve', {
        method: 'POST',
        body: JSON.stringify({ searchKey: discoverySearchKey.trim(), resourceType: discoveryResourceType }),
      });
      setDiscoveryResults(Array.isArray(result) ? result : []);
      toast({ title: 'Discovery complete', description: `${(Array.isArray(result) ? result : []).length} endpoint(s) found` });
    } catch (e: any) {
      toast({ title: 'Discovery failed', description: e.message, variant: 'destructive' });
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const resolveBpnToEndpoint = async () => {
    if (!discoveryBpnInput.trim()) return;
    setDiscoveryLoading(true);
    setDiscoveryBpnResults([]);
    try {
      const result = await apiFetch<any[]>('/api/edc/discovery/edc', {
        method: 'POST',
        body: JSON.stringify({ bpns: [discoveryBpnInput.trim()] }),
      });
      setDiscoveryBpnResults(Array.isArray(result) ? result : []);
      toast({ title: 'EDC Discovery complete', description: `${(Array.isArray(result) ? result : []).length} result(s)` });
    } catch (e: any) {
      toast({ title: 'EDC Discovery failed', description: e.message, variant: 'destructive' });
    } finally {
      setDiscoveryLoading(false);
    }
  };

  // ------------------------------------------------------------------
  //  Render
  // ------------------------------------------------------------------
  const isConnected = edcStatus.status === 'online';

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            EDC Tractus-X Connector
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Eclipse Dataspace Connector — share Digital Product Passports through Catena-X
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={checkStatus}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Status Card */}
      <Card className={edcStatus.status === 'not_configured' ? 'border-yellow-500/30 bg-yellow-500/5' : ''}>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <StatusIcon status={edcStatus.status} />
            <div className="flex-1">
              <p className="font-medium">
                {edcStatus.status === 'online'
                  ? 'Connected'
                  : edcStatus.status === 'checking'
                  ? 'Checking…'
                  : edcStatus.status === 'not_configured'
                  ? <span>Not configured — <span className="underline cursor-pointer text-primary" onClick={() => navigate('/settings?tab=edc')}>Settings → EDC Connector</span></span>
                  : 'Disconnected'}
              </p>
              {edcStatus.status !== 'not_configured' && (
                <p className="text-sm text-muted-foreground">{edcStatus.message}</p>
              )}
            </div>
            {edcStatus.participantId && (
              <Badge variant="outline" className="font-mono text-xs">
                {edcStatus.participantId}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-7 w-full max-w-4xl">
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="negotiations">Negotiations</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
        </TabsList>

        {/* ---- Discovery Tab ---- */}
        <TabsContent value="discovery">
          <div className="space-y-4 mt-4">
            {/* Discovery Status */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Compass className="h-5 w-5" />
                    Catena-X Discovery Services
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={fetchDiscoveryStatus}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Check
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Discovery Services automatically resolve partner identifiers to connector endpoints.
                  No need to manually exchange URLs.
                </p>
                {discoveryStatus ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 rounded-lg border">
                      <StatusIcon status={discoveryStatus.bpnDiscovery?.status || 'not_configured'} />
                      <div>
                        <p className="font-medium text-sm">BPN Discovery</p>
                        <p className="text-xs text-muted-foreground">Identifier → BPN</p>
                        {discoveryStatus.bpnDiscovery?.url && (
                          <p className="text-xs font-mono text-muted-foreground truncate max-w-[250px]">{discoveryStatus.bpnDiscovery.url}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 rounded-lg border">
                      <StatusIcon status={discoveryStatus.edcDiscovery?.status || 'not_configured'} />
                      <div>
                        <p className="font-medium text-sm">EDC Discovery</p>
                        <p className="text-xs text-muted-foreground">BPN → Connector URL</p>
                        {discoveryStatus.edcDiscovery?.url && (
                          <p className="text-xs font-mono text-muted-foreground truncate max-w-[250px]">{discoveryStatus.edcDiscovery.url}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">Click "Check" to verify Discovery Service connections.</p>
                )}

                {discoveryStatus && !discoveryStatus.bpnDiscovery?.configured && !discoveryStatus.edcDiscovery?.configured && (
                  <div className="mt-4 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-sm text-muted-foreground">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Discovery Services not configured — see <span className="underline cursor-pointer" onClick={() => navigate('/settings?tab=edc')}>Settings → EDC Connector</span> for details.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Full Resolve: searchKey → BPN → Connector */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Search className="h-5 w-5" />
                  Resolve Partner Endpoint
                  <Badge variant="outline" className="ml-2 text-xs font-normal">Identifier → BPN → Connector URL</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Part ID / Serial Number / Asset ID"
                      value={discoverySearchKey}
                      onChange={(e) => setDiscoverySearchKey(e.target.value)}
                      className="flex-1 font-mono text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && resolveEndpoints()}
                    />
                    <select
                      value={discoveryResourceType}
                      onChange={(e) => setDiscoveryResourceType(e.target.value)}
                      className="px-3 py-2 border rounded-md text-sm bg-background"
                    >
                      <option value="manufacturerPartId">Manufacturer Part ID</option>
                      <option value="serialNumber">Serial Number</option>
                      <option value="batchId">Batch ID</option>
                      <option value="assetLifecyclePhase">Lifecycle Phase</option>
                    </select>
                    <Button onClick={resolveEndpoints} disabled={discoveryLoading || !discoverySearchKey.trim()}>
                      {discoveryLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Compass className="h-4 w-4 mr-2" />}
                      Resolve
                    </Button>
                  </div>

                  {discoveryResults.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>BPN</TableHead>
                          <TableHead>Connector Endpoint</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {discoveryResults.map((r, idx) => (
                          <TableRow key={idx}>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-xs">{r.bpn}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs max-w-[300px] truncate">{r.connectorEndpoint}</TableCell>
                            <TableCell className="text-right">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost" size="sm"
                                      onClick={() => {
                                        setProviderUrl(r.connectorEndpoint);
                                        setActiveTab('catalog');
                                        toast({ title: 'Provider URL set', description: 'Switch to Catalog tab to request catalog' });
                                      }}
                                    >
                                      <ArrowRight className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Use for Catalog Request</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Direct BPN → Connector lookup */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5" />
                  BPN → Connector Lookup
                  <Badge variant="outline" className="ml-2 text-xs font-normal">If you already know the BPN</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <Input
                    placeholder="BPNL00000003XXXX"
                    value={discoveryBpnInput}
                    onChange={(e) => setDiscoveryBpnInput(e.target.value)}
                    className="flex-1 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && resolveBpnToEndpoint()}
                  />
                  <Button onClick={resolveBpnToEndpoint} disabled={discoveryLoading || !discoveryBpnInput.trim()}>
                    {discoveryLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                    Lookup
                  </Button>
                </div>

                {discoveryBpnResults.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>BPN</TableHead>
                        <TableHead>Connector Endpoints</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {discoveryBpnResults.map((r, idx) => (
                        <TableRow key={idx}>
                          <TableCell><Badge variant="outline" className="font-mono text-xs">{r.bpn}</Badge></TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {(r.connectorEndpoint || []).map((ep: string, i: number) => (
                                <p key={i} className="font-mono text-xs">{ep}</p>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {(r.connectorEndpoint || [])[0] && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost" size="sm"
                                      onClick={() => {
                                        setProviderUrl((r.connectorEndpoint || [])[0]);
                                        setActiveTab('catalog');
                                        toast({ title: 'Provider URL set' });
                                      }}
                                    >
                                      <ArrowRight className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Use for Catalog Request</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---- Catalog Tab ---- */}
        <TabsContent value="catalog">
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="h-5 w-5" />
                Provider Catalog
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Input
                  placeholder="Provider DSP URL (leave empty for default)"
                  value={providerUrl}
                  onChange={(e) => setProviderUrl(e.target.value)}
                  className="flex-1 font-mono text-sm"
                />
                <Button onClick={fetchCatalog} disabled={catalogLoading}>
                  {catalogLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                  Request Catalog
                </Button>
              </div>

              {catalogItems.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catalogItems.map((item, idx) => (
                      <TableRow key={item['@id'] || idx}>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">
                          {item['@id'] || item.id || '—'}
                        </TableCell>
                        <TableCell>{item['dct:title'] || item.name || item.properties?.name || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item['@type'] || 'Dataset'}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[250px] truncate text-muted-foreground text-sm">
                          {item['dct:description'] || item.description || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <ArrowRightLeft className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Negotiate contract</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No catalog entries loaded. Click "Request Catalog" to fetch from a provider.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Assets Tab ---- */}
        <TabsContent value="assets">
          {/* Local Registrations (always available) */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Product Registrations
                  {registrations.length > 0 && (
                    <Badge variant="outline" className="ml-2">
                      {registrationCounts.published} published ·{' '}
                      {registrationCounts.pending} pending
                      {registrationCounts.deleted > 0 && (
                        <> · {registrationCounts.deleted} deleted</>
                      )}
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex gap-2">
                  {registrations.some(r => r.status === 'pending') && (
                    <Button
                      size="sm"
                      onClick={syncPending}
                      disabled={syncLoading}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      {syncLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                      Sync to EDC
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => fetchRegistrations(true)} disabled={registrationsLoading}>
                    {registrationsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {registrations.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Asset ID</TableHead>
                      <TableHead>Policy</TableHead>
                      <TableHead>Contract Def.</TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registrations.map((reg, idx) => (
                      <TableRow key={reg.productId || idx} className={reg.status === 'deleted' ? 'opacity-50' : reg.status === 'pending' ? 'opacity-80' : ''}>
                        <TableCell>
                          {reg.status === 'published' ? (
                            <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30 gap-1">
                              <CheckCircle className="h-3 w-3" />
                              Published
                            </Badge>
                          ) : reg.status === 'deleted' ? (
                            <Badge className="bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-500/30 gap-1">
                              <Trash2 className="h-3 w-3" />
                              Deleted
                            </Badge>
                          ) : reg.status === 'failed' ? (
                            <Badge className="bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30 gap-1">
                              <XCircle className="h-3 w-3" />
                              Failed
                            </Badge>
                          ) : (
                            <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30 gap-1">
                              <Clock className="h-3 w-3" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{reg.productName || reg.productId}</p>
                            <p className="text-xs text-muted-foreground font-mono">{reg.productId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[150px] truncate">{reg.assetId}</TableCell>
                        <TableCell>
                          <Select
                            value={reg.policyId || ''}
                            onValueChange={async (val) => {
                              try {
                                await apiFetch(`/api/edc/registrations/${encodeURIComponent(reg.productId)}/policy`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ policyId: val }),
                                });
                                toast({ title: 'Policy assigned', description: `${val}` });
                                fetchRegistrations();
                              } catch (e: any) {
                                toast({ title: 'Policy assignment failed', description: e.message, variant: 'destructive' });
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs w-[200px]">
                              <SelectValue placeholder="Select policy..." />
                            </SelectTrigger>
                            <SelectContent>
                              {policies.map((pol) => {
                                const pid = pol['@id'] || pol.id;
                                const name = pol.properties?.['htx:policyName'];
                                return (
                                  <SelectItem key={pid} value={pid}>
                                    <span className="truncate">{name ? `${name}` : pid}</span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={reg.contractDefinitionId || ''}
                            onValueChange={async (val) => {
                              try {
                                await apiFetch(`/api/edc/registrations/${encodeURIComponent(reg.productId)}/contract`, {
                                  method: 'PATCH',
                                  body: JSON.stringify({ contractDefinitionId: val }),
                                });
                                toast({ title: 'Contract assigned' });
                                fetchRegistrations();
                              } catch (e: any) {
                                toast({ title: 'Contract assignment failed', description: e.message, variant: 'destructive' });
                              }
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs min-w-[160px]">
                              <SelectValue placeholder="Select contract..." />
                            </SelectTrigger>
                            <SelectContent>
                              {contractDefs.map((cd) => {
                                const cdId = cd['@id'] || cd.id;
                                const name = cd.properties?.['htx:contractName'];
                                return (
                                  <SelectItem key={cdId} value={cdId}>
                                    <span className="truncate">{name || cdId}</span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {reg.registeredAt ? new Date(reg.registeredAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost" size="sm"
                                  onClick={() => deleteRegistration(reg.productId)}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Remove registration</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No products registered yet. Use "Publish to EDC" from the Data table.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Live EDC Assets (only when connected) */}
          {isConnected && (
            <Card className="mt-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Live EDC Assets
                    <Badge variant="outline" className="text-xs">Connector</Badge>
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={fetchAssets} disabled={assetsLoading}>
                    {assetsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {assets.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Status</TableHead>
                        <TableHead>Asset ID</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Content Type</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assets.map((asset, idx) => (
                        <TableRow key={asset['@id'] || asset.id || idx}>
                          <TableCell>
                            <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30">
                              <CheckCircle className="h-3 w-3 mr-1" />EDC
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[200px] truncate">
                            {asset['@id'] || asset.id || '—'}
                          </TableCell>
                          <TableCell>{asset.properties?.name || asset.name || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{asset.properties?.contenttype || 'unknown'}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost" size="sm"
                                    onClick={() => deleteAsset(asset['@id'] || asset.id)}
                                  >
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete asset</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Click Refresh to load assets from the live EDC connector.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---- Policies Tab ---- */}
        <TabsContent value="policies">
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Policy Definitions
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPolicyDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Policy
                  </Button>
                  <Button variant="outline" size="sm" onClick={fetchPolicies} disabled={policiesLoading}>
                    {policiesLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {policies.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Policy ID</TableHead>
                      <TableHead>Permission</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policies.map((pol, idx) => {
                      const perms = pol.policy?.['odrl:permission'] || [];
                      const action = perms[0]?.['odrl:action'] || '—';
                      const synced = pol._local?.syncedToEdc;
                      const isLocal = !!pol._local;
                      return (
                        <TableRow key={pol['@id'] || pol.id || idx}>
                          <TableCell>
                            {isLocal ? (
                              synced ? (
                                <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">
                                  <CheckCircle className="h-3 w-3 mr-1" />Synced
                                </Badge>
                              ) : (
                                <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30">
                                  <Clock className="h-3 w-3 mr-1" />Pending
                                </Badge>
                              )
                            ) : (
                              <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30">
                                <CheckCircle className="h-3 w-3 mr-1" />EDC
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {pol.properties?.['htx:policyName'] || <span className="text-muted-foreground italic">Unnamed</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[180px] truncate">
                            {pol['@id'] || pol.id || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{action}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" onClick={() => openEditPolicy(pol)}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit policy</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" onClick={() => deletePolicy(pol['@id'] || pol.id)}>
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete policy</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No policies defined. Create a DCP-compliant usage policy.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- Create DCP Policy Dialog ---- */}
          <Dialog open={policyDialogOpen} onOpenChange={(open) => {
            setPolicyDialogOpen(open);
            if (!open) {
              setEditingPolicy(null);
              setPolicyForm({ name: '', permission: 'use', purpose: '', credentialType: 'MembershipCredential', validFrom: '', validTo: '' });
            }
          }}>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  {editingPolicy ? 'Edit DCP Policy' : 'Create DCP Policy'}
                </DialogTitle>
                <DialogDescription>
                  Decentralized Claims Protocol (DCP) compliant ODRL policy with
                  credential-based access control.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                {/* Policy Name */}
                <div className="grid gap-1.5">
                  <Label htmlFor="pol-name">Policy Name *</Label>
                  <Input
                    id="pol-name"
                    placeholder="e.g. DPP Quality Data - Read Only"
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>

                {/* Permission */}
                <div className="grid gap-1.5">
                  <Label>Permission</Label>
                  <Select
                    value={policyForm.permission}
                    onValueChange={(v) => setPolicyForm(f => ({ ...f, permission: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="use">use — general usage</SelectItem>
                      <SelectItem value="transfer">transfer — data transfer</SelectItem>
                      <SelectItem value="read">read — read access</SelectItem>
                      <SelectItem value="write">write — write access</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Purpose */}
                <div className="grid gap-1.5">
                  <Label>Purpose</Label>
                  <Select
                    value={policyForm.purpose}
                    onValueChange={(v) => setPolicyForm(f => ({ ...f, purpose: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select purpose (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quality-analysis">Quality Analysis</SelectItem>
                      <SelectItem value="supply-chain-tracking">Supply Chain Tracking</SelectItem>
                      <SelectItem value="regulatory-compliance">Regulatory Compliance</SelectItem>
                      <SelectItem value="circular-economy">Circular Economy</SelectItem>
                      <SelectItem value="r-and-d">Research & Development</SelectItem>
                      <SelectItem value="digital-product-passport">Digital Product Passport</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Credential Type */}
                <div className="grid gap-1.5">
                  <Label>Credential Type (DCP)</Label>
                  <Select
                    value={policyForm.credentialType}
                    onValueChange={(v) => setPolicyForm(f => ({ ...f, credentialType: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MembershipCredential">MembershipCredential</SelectItem>
                      <SelectItem value="DismantlerCredential">DismantlerCredential</SelectItem>
                      <SelectItem value="FrameworkAgreementCredential">FrameworkAgreementCredential</SelectItem>
                      <SelectItem value="BpnCredential">BpnCredential</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Time Window */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="pol-from">Valid From</Label>
                    <Input
                      id="pol-from" type="datetime-local"
                      value={policyForm.validFrom}
                      onChange={(e) => setPolicyForm(f => ({ ...f, validFrom: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="pol-to">Valid To</Label>
                    <Input
                      id="pol-to" type="datetime-local"
                      value={policyForm.validTo}
                      onChange={(e) => setPolicyForm(f => ({ ...f, validTo: e.target.value }))}
                    />
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setPolicyDialogOpen(false)}>Cancel</Button>
                <Button onClick={createPolicy} disabled={policyCreating || !policyForm.name.trim()}>
                  {policyCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingPolicy ? 'Update Policy' : 'Create Policy'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ---- Contract Definitions Tab ---- */}
        <TabsContent value="contracts">
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Contract Definitions
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setContractDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Contract
                  </Button>
                  <Button variant="outline" size="sm" onClick={fetchContractDefs} disabled={contractDefsLoading}>
                    {contractDefsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {contractDefs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Contract ID</TableHead>
                      <TableHead>Provider / Consumer</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Validity</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractDefs.map((cd, idx) => {
                      const synced = cd._local?.syncedToEdc;
                      const isLocal = !!cd._local;
                      const props = cd.properties || {};
                      const provider = props['htx:provider'] || '—';
                      const consumer = props['htx:consumer'] || '—';
                      const purpose = props['htx:purpose'] || '—';
                      const validFrom = props['htx:validFrom'] ? new Date(props['htx:validFrom']).toLocaleDateString() : '';
                      const validTo = props['htx:validTo'] ? new Date(props['htx:validTo']).toLocaleDateString() : '';
                      const validity = validFrom || validTo ? `${validFrom || '…'} – ${validTo || '…'}` : '—';
                      return (
                        <TableRow key={cd['@id'] || cd.id || idx}>
                          <TableCell>
                            {isLocal ? (
                              synced ? (
                                <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">
                                  <CheckCircle className="h-3 w-3 mr-1" />Synced
                                </Badge>
                              ) : (
                                <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-500/30">
                                  <Clock className="h-3 w-3 mr-1" />Pending
                                </Badge>
                              )
                            ) : (
                              <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30">
                                <CheckCircle className="h-3 w-3 mr-1" />EDC
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {props['htx:contractName'] || <span className="text-muted-foreground italic">Unnamed</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[150px] truncate">
                            {cd['@id'] || cd.id || '—'}
                          </TableCell>
                          <TableCell className="text-xs max-w-[160px]">
                            <div className="truncate">{provider}</div>
                            {consumer !== '—' && <div className="truncate text-muted-foreground">↔ {consumer}</div>}
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">{purpose}</TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{validity}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" onClick={() => openEditContract(cd)}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit contract</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="sm" onClick={() => deleteContractDef(cd['@id'] || cd.id)}>
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete contract</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No contract definitions. Link an asset with a policy to create one.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- Create/Edit Contract Dialog ---- */}
          <Dialog open={contractDialogOpen} onOpenChange={(open) => {
            setContractDialogOpen(open);
            if (!open) {
              setEditingContract(null);
              setContractForm(emptyContractForm);
            }
          }}>
            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {editingContract ? 'Edit Contract Definition' : 'Create Contract Definition'}
                </DialogTitle>
                <DialogDescription>
                  Vertragliche Rahmenbedingungen definieren. Die Zuordnung zu Assets und Policies
                  erfolgt im Assets-Tab.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                {/* Contract Name */}
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-name">Vertragsbezeichnung *</Label>
                  <Input
                    id="cd-name"
                    placeholder="z.B. DPP-Datenzugang Hydro ASA – Battery Pass"
                    value={contractForm.name}
                    onChange={(e) => setContractForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>

                {/* Description */}
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-desc">Beschreibung / Vertragsgegenstand</Label>
                  <Textarea
                    id="cd-desc"
                    placeholder="Gegenstand und Umfang des Vertrags…"
                    className="min-h-[60px]"
                    value={contractForm.description}
                    onChange={(e) => setContractForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>

                {/* Provider / Consumer */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="cd-provider">Datenanbieter (Provider)</Label>
                    <Input
                      id="cd-provider"
                      placeholder="z.B. Hydro ASA (BPN…)"
                      value={contractForm.provider}
                      onChange={(e) => setContractForm(f => ({ ...f, provider: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cd-consumer">Datenabnehmer (Consumer)</Label>
                    <Input
                      id="cd-consumer"
                      placeholder="z.B. Battery Pass Consortium"
                      value={contractForm.consumer}
                      onChange={(e) => setContractForm(f => ({ ...f, consumer: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Provider DSP Endpoint */}
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-endpoint">Provider DSP Endpoint</Label>
                  <Input
                    id="cd-endpoint"
                    placeholder="z.B. https://provider.example.com/api/v1/dsp"
                    value={contractForm.providerEndpoint}
                    onChange={(e) => setContractForm(f => ({ ...f, providerEndpoint: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    DSP-Endpunkt des Anbieters — wird bei Verhandlungen automatisch übernommen
                  </p>
                </div>

                {/* Validity Period */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="cd-from">Gültig ab</Label>
                    <Input
                      id="cd-from" type="date"
                      value={contractForm.validFrom}
                      onChange={(e) => setContractForm(f => ({ ...f, validFrom: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cd-to">Gültig bis</Label>
                    <Input
                      id="cd-to" type="date"
                      value={contractForm.validTo}
                      onChange={(e) => setContractForm(f => ({ ...f, validTo: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Purpose */}
                <div className="grid gap-1.5">
                  <Label>Nutzungszweck</Label>
                  <Select
                    value={contractForm.purpose}
                    onValueChange={(v) => setContractForm(f => ({ ...f, purpose: v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Zweck auswählen…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="digital-product-passport">Digital Product Passport (DPP)</SelectItem>
                      <SelectItem value="quality-analysis">Qualitätsanalyse</SelectItem>
                      <SelectItem value="supply-chain-tracking">Lieferkettenverfolgung</SelectItem>
                      <SelectItem value="regulatory-compliance">Regulatorische Compliance</SelectItem>
                      <SelectItem value="circular-economy">Kreislaufwirtschaft</SelectItem>
                      <SelectItem value="r-and-d">Forschung & Entwicklung</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Terms & Conditions */}
                <div className="grid gap-1.5">
                  <Label htmlFor="cd-terms">Vertragsbedingungen / Besondere Vereinbarungen</Label>
                  <Textarea
                    id="cd-terms"
                    placeholder="Haftung, Vertraulichkeit, Kündigungsfristen, etc."
                    className="min-h-[60px]"
                    value={contractForm.terms}
                    onChange={(e) => setContractForm(f => ({ ...f, terms: e.target.value }))}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setContractDialogOpen(false)}>Cancel</Button>
                <Button onClick={createOrUpdateContract} disabled={contractCreating || !contractForm.name.trim()}>
                  {contractCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingContract ? 'Update Contract' : 'Create Contract'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ---- Negotiations Tab ---- */}
        <TabsContent value="negotiations">
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5" />
                  Contract Negotiations
                  <Badge variant="outline" className="text-xs">DSP</Badge>
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setNegotiationDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Start Negotiation
                  </Button>
                  <Button variant="outline" size="sm" onClick={fetchNegotiations} disabled={negotiationsLoading}>
                    {negotiationsLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* DSP Negotiation State Flow */}
              <div className="mb-4 flex items-center gap-1 text-xs text-muted-foreground">
                <span className="font-medium">DSP Flow:</span>
                <Badge variant="outline" className="text-[10px] px-1.5">REQUESTED</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline" className="text-[10px] px-1.5">OFFERED</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline" className="text-[10px] px-1.5">ACCEPTED</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline" className="text-[10px] px-1.5">AGREED</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge variant="outline" className="text-[10px] px-1.5">VERIFIED</Badge>
                <ArrowRight className="h-3 w-3" />
                <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30 text-[10px] px-1.5">FINALIZED</Badge>
              </div>

              {negotiations.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Contract</TableHead>
                      <TableHead>Negotiation ID</TableHead>
                      <TableHead>Counterparty</TableHead>
                      <TableHead>Agreement ID</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {negotiations.map((neg, idx) => {
                      const negContractId = neg.contractDefinitionId || neg['edc:contractDefinitionId'] || '';
                      const matchedContract = contractDefById.get(negContractId);
                      const contractLabel = matchedContract?.properties?.['htx:contractName'] || negContractId || '—';
                      return (
                      <TableRow key={neg['@id'] || neg.id || idx}>
                        <TableCell>{statusBadge(neg.state || neg['edc:state'])}</TableCell>
                        <TableCell className="text-xs max-w-[160px] truncate" title={negContractId}>
                          {contractLabel}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[160px] truncate">
                          {neg['@id'] || neg.id || '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                          {neg.counterPartyAddress || neg['edc:counterPartyAddress'] || '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[160px] truncate">
                          {neg.contractAgreementId || neg['edc:contractAgreementId'] || <span className="text-muted-foreground italic">pending</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => {
                                  const negId = neg['@id'] || neg.id;
                                  if (negId) {
                                    navigator.clipboard.writeText(negId);
                                    toast({ title: 'Negotiation ID copied' });
                                  }
                                }}>
                                  <Search className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy Negotiation ID</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => {
                                  const negId = neg['@id'] || neg.id;
                                  if (negId) deleteNegotiation(negId);
                                }}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {neg._local?.syncedToEdc ? 'Verhandlung zurückziehen' : 'Verhandlung löschen'}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Noch keine Verhandlungen. Wählen Sie einen Vertrag und starten Sie eine Verhandlung.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---- Start Negotiation Dialog ---- */}
          <Dialog open={negotiationDialogOpen} onOpenChange={setNegotiationDialogOpen}>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ArrowRightLeft className="h-5 w-5" />
                  Vertragsverhandlung starten
                </DialogTitle>
                <DialogDescription>
                  Wählen Sie den Vertrag aus, der mit dem Provider verhandelt werden soll.
                  Provider und Consumer sind im Vertrag bereits hinterlegt.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label>Vertrag (Contract Definition) *</Label>
                  <Select
                    value={negotiationForm.contractId}
                    onValueChange={(v) => {
                      const cd = contractDefById.get(v);
                      const endpoint = cd?.properties?.['htx:providerEndpoint'] || '';
                      setNegotiationForm(f => ({ ...f, contractId: v, providerUrl: endpoint || f.providerUrl }));
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Vertrag auswählen…" /></SelectTrigger>
                    <SelectContent>
                      {contractDefs.map((cd) => {
                        const cdId = cd['@id'] || cd.id;
                        const name = cd.properties?.['htx:contractName'];
                        const provider = cd.properties?.['htx:provider'];
                        const consumer = cd.properties?.['htx:consumer'];
                        const subtitle = [provider, consumer].filter(Boolean).join(' ↔ ');
                        return (
                          <SelectItem key={cdId} value={cdId}>
                            <div className="flex flex-col">
                              <span>{name || cdId}</span>
                              {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="neg-provider">Provider DSP Endpoint *</Label>
                  <Input
                    id="neg-provider"
                    placeholder="z.B. https://provider.example.com/api/v1/dsp"
                    value={negotiationForm.providerUrl}
                    onChange={(e) => setNegotiationForm(f => ({ ...f, providerUrl: e.target.value }))}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {negotiationForm.contractId && contractDefById.get(negotiationForm.contractId)?.properties?.['htx:providerEndpoint']
                      ? 'Automatisch aus dem Vertrag übernommen — kann bei Bedarf angepasst werden'
                      : 'DSP-Protokoll-Endpunkt des Datenanbieters (wird im Vertrag hinterlegt)'}
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setNegotiationDialogOpen(false)}>Abbrechen</Button>
                <Button
                  onClick={startNegotiation}
                  disabled={negotiationStarting || !negotiationForm.contractId || !negotiationForm.providerUrl}
                >
                  {negotiationStarting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Verhandlung starten
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ---- Transfers Tab ---- */}
        <TabsContent value="transfers">
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Send className="h-5 w-5" />
                  Data Transfers
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchTransfers} disabled={transfersLoading}>
                  {transfersLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {transfers.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Transfer ID</TableHead>
                      <TableHead>Asset ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfers.map((tr, idx) => (
                      <TableRow key={tr['@id'] || tr.id || idx}>
                        <TableCell>{statusBadge(tr.state || tr['edc:state'])}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[180px] truncate">
                          {tr['@id'] || tr.id || '—'}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">
                          {tr.assetId || tr['edc:assetId'] || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {tr.dataDestination?.type || tr['edc:dataDestination']?.type || 'HttpProxy'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" onClick={() => {
                                  const trId = tr['@id'] || tr.id;
                                  if (trId) {
                                    navigator.clipboard.writeText(trId);
                                    toast({ title: 'Transfer ID copied' });
                                  }
                                }}>
                                  <Search className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy Transfer ID</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No transfers yet. Negotiate a contract first, then initiate a transfer.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
