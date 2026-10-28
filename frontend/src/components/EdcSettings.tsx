/**
 * EDC Settings — EDC Connector configuration & status panel for Settings page.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Wifi, WifiOff, AlertCircle, Loader2, Compass,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { apiFetch } from '../config/api';

interface EdcStatus {
  status: 'online' | 'offline' | 'error' | 'not_configured' | 'checking';
  message: string;
  managementUrl: string;
  participantId: string;
}

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

export function EdcSettings() {
  const [edcStatus, setEdcStatus] = useState<EdcStatus>({
    status: 'checking', message: 'Checking…', managementUrl: '', participantId: '',
  });
  const [discoveryStatus, setDiscoveryStatus] = useState<any>(null);

  const checkStatus = useCallback(async () => {
    setEdcStatus(prev => ({ ...prev, status: 'checking', message: 'Checking…' }));
    try {
      const resp = await apiFetch('/api/edc/status', {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setEdcStatus(await resp.json());
    } catch {
      setEdcStatus({ status: 'error', message: 'Backend unreachable', managementUrl: '', participantId: '' });
    }
  }, []);

  const fetchDiscoveryStatus = useCallback(async () => {
    try {
      const resp = await apiFetch('/api/edc/discovery/status', {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setDiscoveryStatus(await resp.json());
    } catch {
      setDiscoveryStatus(null);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    fetchDiscoveryStatus();
  }, [checkStatus, fetchDiscoveryStatus]);

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Configuration Required */}
      {edcStatus.status === 'not_configured' && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="py-4 text-sm text-muted-foreground">
            <p className="font-medium text-yellow-600 dark:text-yellow-400 mb-2">Configuration required</p>
            <p>Set the following environment variables in <code className="bg-muted px-1 rounded">backend/config/env/.env</code>:</p>
            <ul className="list-disc list-inside mt-2 space-y-1 font-mono text-xs">
              <li>EDC_MANAGEMENT_URL — e.g. http://localhost:19193/management</li>
              <li>EDC_PROTOCOL_URL — e.g. http://localhost:19194/protocol</li>
              <li>EDC_API_KEY — Management API key</li>
              <li>EDC_PARTICIPANT_ID — Your BPN / participant ID</li>
              <li>EDC_PROVIDER_PROTOCOL_URL — Default provider DSP endpoint</li>
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Discovery Services */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="h-5 w-5" />
            Catena-X Discovery Services
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Discovery Services automatically resolve partner identifiers to connector endpoints.
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
            <p className="text-sm text-muted-foreground text-center py-4">Checking Discovery Service connections…</p>
          )}

          {discoveryStatus && !discoveryStatus.bpnDiscovery?.configured && !discoveryStatus.edcDiscovery?.configured && (
            <Card className="border-yellow-500/30 bg-yellow-500/5 mt-4">
              <CardContent className="py-3 text-sm text-muted-foreground">
                <p className="font-medium text-yellow-600 dark:text-yellow-400 mb-2">Discovery Services not configured</p>
                <p>Add these to <code className="bg-muted px-1 rounded">backend/config/env/.env</code>:</p>
                <ul className="list-disc list-inside mt-2 space-y-1 font-mono text-xs">
                  <li>EDC_BPN_DISCOVERY_URL</li>
                  <li>EDC_EDC_DISCOVERY_URL</li>
                  <li>EDC_DISCOVERY_AUTH_URL (OAuth2 token endpoint)</li>
                  <li>EDC_DISCOVERY_CLIENT_ID</li>
                  <li>EDC_DISCOVERY_CLIENT_SECRET</li>
                </ul>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
