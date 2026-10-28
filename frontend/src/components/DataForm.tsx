/**
 * DataForm — two-step schema-driven product data entry form.
 *
 * Step 1: Basic material fields (generated from YAML metadata)
 * Step 2: Chemical composition — dynamic rows with element, CAS,
 *         min/max OR avg input, plus button to add rows.
 */

// Trademark notice: "Asset Administration Shell" (AAS) and the AAS logo are
// trademarks of the Industrial Digital Twin Association (IDTA), referenced here
// for identification and interoperability purposes only.

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useToast } from './ui/use-toast'
import { Loader2, Info, AlertTriangle, Plus, Trash2, ArrowLeft, ArrowRight, Tag, FlaskConical, Upload, PenLine, FileJson, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover'
import { useSystemStatus } from '../contexts/SystemStatusContext'
import { useAppProfile } from '../contexts/AppProfileContext'
import { useSchemaFields, fieldLabel, fieldUnit, type SchemaField } from '../hooks/useSchemaFields'
import { apiFetch } from '../config/api'

// Dynamic record — every field is a string keyed by its YAML name
export type FormData = Record<string, unknown> & {
  productId: string
  githubUrl?: string
  githubRawUrl?: string
  chemicalComposition?: CompositionRow[]
}

interface CompositionRow {
  element: string
  cas: string
  mode: 'avg' | 'range'   // UI toggle: single value or min/max
  avg: string
  min: string
  max: string
  fractionType: string
}

interface DataFormProps {
  editData?: FormData | null
  onSuccess?: (savedData: FormData) => void
}

function emptyRow(): CompositionRow {
  return { element: '', cas: '', mode: 'range', avg: '', min: '', max: '', fractionType: 'Product' }
}

/** Build a blank form from schema fields */
function emptyForm(schemaFields: SchemaField[]): FormData {
  const form: Record<string, string> = { productId: '' }
  for (const f of schemaFields) {
    if (f.field !== 'chemicalComposition') form[f.field] = ''
  }
  return form as FormData
}

/** Parse existing composition data into editable rows */
function parseComposition(raw: unknown): CompositionRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  return raw.map((item: any) => ({
    element: item.element || '',
    cas: item.cas || '',
    mode: (item.min || item.max) ? 'range' as const : 'avg' as const,
    avg: item.avg != null ? String(item.avg) : '',
    min: item.min != null ? String(item.min) : '',
    max: item.max != null ? String(item.max) : '',
    fractionType: item.fractionType || 'Product',
  }))
}

// ── AAS JSON parser ────────────────────────────────────────────

/** Strip trailing ".0" from numbers serialized as strings (e.g. "60.0" → "60") */
function cleanNumStr(v: string): string {
  if (!v) return v
  return v.replace(/\.0$/, '')
}

/** Helper: find a Property value inside an SMC / SML value array */
function aasFind(elements: any[], idShort: string): string {
  for (const el of elements) {
    if (el.idShort === idShort && el.modelType === 'Property') {
      const val = el.value
      if (val == null) return ''
      return String(val)
    }
  }
  return ''
}

/** Helper: find a SubmodelElementCollection by idShort */
function aasFindSmc(elements: any[], idShort: string): any | null {
  return elements.find((el: any) => el.idShort === idShort && (el.modelType === 'SubmodelElementCollection' || el.modelType === 'SubmodelElementList')) ?? null
}

/**
 * Helper: resolve leaf properties from an SMC/SML.
 * If the container is a SubmodelElementList (with nested entries),
 * flatten the first entry's value; otherwise return value directly.
 */
function aasFlatProps(smc: any): any[] {
  const vals = smc?.value ?? []
  if (smc?.modelType === 'SubmodelElementList' && vals.length > 0 && vals[0]?.value) {
    return vals[0].value
  }
  return vals
}

/** Extract productId from the AAS envelope (id or globalAssetId) */
function extractProductId(json: any): string {
  const shells: any[] = json.assetAdministrationShells ?? []
  if (shells.length === 0) return ''
  const shell = shells[0]
  // Try to extract from id (e.g. "https://htx-demo.com/aas/PROD-001")
  const aasId: string = shell.id ?? ''
  const assetId: string = shell.assetInformation?.globalAssetId ?? ''
  // Take the last path segment, remove common suffixes
  for (const candidate of [aasId, assetId]) {
    if (!candidate) continue
    const segment = candidate.split('/').pop() ?? ''
    // Remove -aas.json suffix or similar
    const cleaned = segment.replace(/-aas\.json$/i, '').replace(/-aas$/i, '')
    if (cleaned && cleaned !== 'unknown') return cleaned
  }
  return ''
}

interface AasImportResult {
  fields: Record<string, string>
  composition: CompositionRow[]
}

/** Parse BaSyx AAS JSON (exported via /api/export/aas) into flat material fields */
function parseAasJson(json: any): AasImportResult {
  const fields: Record<string, string> = {}
  const composition: CompositionRow[] = []

  // Extract productId from AAS envelope
  const productId = extractProductId(json)
  if (productId) fields.productId = productId

  const submodels: any[] = json.submodels ?? []

  for (const sm of submodels) {
    const elements: any[] = sm.submodelElements ?? []

    // ── MaterialComposition submodel (VDA 231-301 path) ──
    const materialsEl = aasFindSmc(elements, 'Materials')
    if (materialsEl) {
      // Materials is a SubmodelElementList with one or more entries
      const matEntries: any[] = materialsEl.value ?? []
      if (matEntries.length > 0) {
        const mat = matEntries[0] // first material entry
        const matElements: any[] = mat.value ?? []

        fields.materialId = aasFind(matElements, 'MaterialId')

        // MaterialNomenclatures (may be SMC or SML with nested entry)
        const noms = aasFindSmc(matElements, 'MaterialNomenclatures')
        if (noms) {
          const nomVals = aasFlatProps(noms)
          fields.nomenclatureStandard = aasFind(nomVals, 'Standard')
          fields.designation = aasFind(nomVals, 'Designation')
          fields.productName = aasFind(nomVals, 'Designation') // productName == designation
          fields.materialNumber = aasFind(nomVals, 'MaterialNumber')
          fields.alloyGroup = aasFind(nomVals, 'MaterialFamily')
        }

        // MaterialClassifications (may be SMC or SML with nested entries)
        const cls = aasFindSmc(matElements, 'MaterialClassifications')
        if (cls) {
          const clsVals = aasFlatProps(cls)
          fields.classificationStandard = aasFind(clsVals, 'Standard')
          fields.classificationCategory = aasFind(clsVals, 'Category')
          fields.classificationClass = aasFind(clsVals, 'Class')
          fields.classificationSubclass = aasFind(clsVals, 'Subclass')
        }

        // ChemicalComposition
        const chem = aasFindSmc(matElements, 'ChemicalComposition')
        if (chem) {
          const chemVals = chem.value ?? []
          fields.compositionStandard = aasFind(chemVals, 'Standard')
          fields.compositionUnit = aasFind(chemVals, 'Unit')

          const elemsList = aasFindSmc(chemVals, 'ChemicalElements')
          if (elemsList) {
            for (const entry of (elemsList.value ?? [])) {
              const props = entry.value ?? []
              const symbol = aasFind(props, 'ChemicalSymbol')
              const cas = aasFind(props, 'CASNumber')
              const avg = cleanNumStr(aasFind(props, 'AvgPercentage'))
              const min = cleanNumStr(aasFind(props, 'MinPercentage'))
              const max = cleanNumStr(aasFind(props, 'MaxPercentage'))
              composition.push({
                element: symbol,
                cas,
                mode: (min || max) ? 'range' : 'avg',
                avg: avg || '',
                min: min || '',
                max: max || '',
                fractionType: 'Product',
              })
            }
          }
        }
      }
      continue
    }

    // ── MaterialInformation submodel (generic DPP path) ──
    if (sm.idShort === 'MaterialInformation') {
      fields.productName = aasFind(elements, 'ProductName')
      fields.materialName = aasFind(elements, 'MaterialName')
      fields.manufacturer = aasFind(elements, 'Manufacturer')
    }
    // ── SustainabilityInformation submodel ──
    if (sm.idShort === 'SustainabilityInformation') {
      fields.recycledContent = aasFind(elements, 'RecycledContent')
      fields.co2Equivalent = aasFind(elements, 'CO2Equivalent')
      fields.co2Method = aasFind(elements, 'CO2Method')
    }
  }

  return { fields, composition }
}

export function DataForm({ editData, onSuccess }: DataFormProps) {
  const { toast } = useToast()
  const { status: systemStatus } = useSystemStatus()
  const { configId, dataFolder } = useAppProfile()
  const { schemaFields, loading: schemaLoading } = useSchemaFields()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<FormData>(emptyForm(schemaFields))
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [inputMode, setInputMode] = useState<'manual' | 'import'>('manual')
  const [isDragging, setIsDragging] = useState(false)
  const [importedFileName, setImportedFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importedRef = useRef(false)  // guards useEffect from resetting after import

  // CRMA check result (populated after AAS import)
  const [crmaResult, setCrmaResult] = useState<{ crmaStatus: string; crmaDetails: { element: string; cas: string; critical: boolean; strategic: boolean; materialName: string }[] } | null>(null)

  // Composition rows (Step 2)
  const [compositionRows, setCompositionRows] = useState<CompositionRow[]>([])

  // Check if schema has chemicalComposition field
  const hasComposition = schemaFields.some(f => f.field === 'chemicalComposition')

  // Field grouping for the three-step form
  const NOMENCLATURE_FIELDS = ['productName', 'materialId', 'designation', 'materialNumber', 'alloyGroup', 'nomenclatureStandard']
  const CLASSIFICATION_FIELDS = ['classificationStandard', 'classificationCategory', 'classificationClass', 'classificationSubclass']
  const COMPOSITION_HEADER_FIELDS = ['compositionStandard', 'compositionUnit']
  const GROUPED_FIELDS = new Set([...NOMENCLATURE_FIELDS, ...CLASSIFICATION_FIELDS, ...COMPOSITION_HEADER_FIELDS, 'chemicalComposition'])

  const nomenclatureFields = schemaFields.filter(f => NOMENCLATURE_FIELDS.includes(f.field))
  const classificationFields = schemaFields.filter(f => CLASSIFICATION_FIELDS.includes(f.field))
  const compositionHeaderFields = schemaFields.filter(f => COMPOSITION_HEADER_FIELDS.includes(f.field))
  const otherFields = schemaFields.filter(f => !GROUPED_FIELDS.has(f.field))

  // Re-initialise when schema loads or editData changes
  useEffect(() => {
    if (editData) {
      importedRef.current = false
      setImportedFileName(null)
      setFormData(editData)
      const existing = parseComposition((editData as any).chemicalComposition)
      setCompositionRows(existing.length > 0 ? existing : [emptyRow()])
      setStep(1)
    } else if (!importedRef.current) {
      // Only reset when no AAS import has populated the form
      setFormData(emptyForm(schemaFields))
      setCompositionRows([emptyRow()])
      setStep(1)
    }
  }, [editData, schemaFields])

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // ── Composition row handlers ────────────────────────────────
  const updateRow = useCallback((index: number, patch: Partial<CompositionRow>) => {
    setCompositionRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r))
  }, [])

  const addRow = useCallback(() => {
    setCompositionRows(prev => [...prev, emptyRow()])
  }, [])

  const removeRow = useCallback((index: number) => {
    setCompositionRows(prev => prev.length <= 1 ? [emptyRow()] : prev.filter((_, i) => i !== index))
  }, [])

  // ── AAS file import handler ─────────────────────────────────
  const handleAasFile = useCallback((file: File) => {
    if (!file.name.endsWith('.json')) {
      toast({ title: 'Invalid file', description: 'Please drop a JSON file', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string)
        if (!json.submodels && !json.assetAdministrationShells) {
          toast({ title: 'Invalid AAS format', description: 'File does not contain AAS submodels.', variant: 'destructive' })
          return
        }
        const result = parseAasJson(json)

        // Mark that we have imported data (prevents useEffect from resetting)
        importedRef.current = true

        // Merge parsed fields into formData
        setFormData(prev => {
          const updated = { ...prev }
          for (const [key, value] of Object.entries(result.fields)) {
            if (value) updated[key] = value
          }
          return updated as FormData
        })

        // Set composition rows
        if (result.composition.length > 0) {
          setCompositionRows(result.composition)

          // Trigger CRMA check against imported composition
          const crmaPayload = result.composition
            .filter(r => r.element.trim())
            .map(r => ({ element: r.element, cas: r.cas }))
          if (crmaPayload.length > 0) {
            apiFetch('/api/check-crma', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chemicalComposition: crmaPayload }),
            })
              .then(res => res.json())
              .then(crma => {
                setCrmaResult(crma)
                // Store in formData so it's submitted with the product
                setFormData(prev => ({ ...prev, crmaStatus: crma.crmaStatus, crmaDetails: crma.crmaDetails }))
              })
              .catch(err => console.warn('[AAS Import] CRMA check failed:', err))
          }
        }

        setImportedFileName(file.name)
        toast({ title: 'AAS imported', description: `Loaded ${Object.keys(result.fields).filter(k => result.fields[k]).length} fields and ${result.composition.length} substances from ${file.name}` })

        // Switch to manual mode to review/edit
        setInputMode('manual')
        setStep(1)
      } catch {
        toast({ title: 'Parse error', description: 'Could not parse the JSON file.', variant: 'destructive' })
      }
    }
    reader.readAsText(file)
  }, [toast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleAasFile(file)
  }, [handleAasFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  // ── Async job polling ──────────────────────────────────────
  const pollJobStatus = async (jobId: string): Promise<FormData> => {
    const maxAttempts = 30
    const pollInterval = 1000

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const statusResponse = await apiFetch(`/api/job-status/${jobId}`)
      if (!statusResponse.ok) throw new Error('Failed to check job status')
      const status = await statusResponse.json()

      if (status.status === 'completed') {
        return {
          ...formData,
          productId: status.product_id,
          githubUrl: status.github_url,
          githubRawUrl: status.github_raw_url,
        }
      } else if (status.status === 'failed') {
        throw new Error(status.error_message || 'Processing failed')
      }

      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }
    }
    throw new Error('Polling timeout - auto-refresh will update when complete')
  }

  // ── Submit ─────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (systemStatus.backend.status === 'offline') {
      toast({ title: 'Backend offline', description: 'Please start the container or Kubernetes stack', variant: 'destructive' })
      return
    }
    if (systemStatus.nats.status === 'offline') {
      toast({ title: 'NATS offline', description: 'NATS JetStream is not available.', variant: 'destructive' })
      return
    }
    setLoading(true)

    try {
      const tempProductId = editData?.productId || `temp-${Date.now()}`

      // Build structured composition from rows
      const compositionPayload = compositionRows
        .filter(r => r.element.trim() !== '')
        .map(r => {
          const entry: Record<string, string> = {
            element: r.element.trim(),
            cas: r.cas.trim(),
            fractionType: r.fractionType || 'Product',
          }
          if (r.mode === 'avg') {
            if (r.avg) entry.avg = r.avg
          } else {
            if (r.min) entry.min = r.min
            if (r.max) entry.max = r.max
          }
          return entry
        })

      const optimisticData: FormData = {
        ...formData,
        productId: tempProductId,
        githubUrl: editData?.githubUrl || 'pending',
        githubRawUrl: editData?.githubRawUrl || 'pending',
        chemicalComposition: compositionPayload as any,
      }

      // Build payload dynamically from schema fields
      const dataPayload: Record<string, unknown> = {
        productId: editData ? formData.productId : '',
      }
      const allFlatFields = [...nomenclatureFields, ...classificationFields, ...compositionHeaderFields, ...otherFields]
      for (const f of allFlatFields) {
        dataPayload[f.field] = formData[f.field] || ''
      }
      if (hasComposition && compositionPayload.length > 0) {
        dataPayload.chemicalComposition = compositionPayload
      }

      const requestData: Record<string, unknown> = { file_path: `data/${dataFolder}/`, data: dataPayload }
      if (configId) requestData.config_id = configId

      const asyncResponse = await apiFetch('/api/write-json-async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      })

      if (asyncResponse.ok) {
        const result = await asyncResponse.json()

        const realProductId = result.productId || tempProductId
        const optimisticWithRealId: FormData = {
          ...optimisticData,
          productId: realProductId,
        }

        if (!editData) {
          const existingOptimistic = JSON.parse(sessionStorage.getItem('optimisticProducts') || '[]')
          existingOptimistic.push({ ...optimisticWithRealId, _jobId: result.job_id, _timestamp: Date.now() })
          sessionStorage.setItem('optimisticProducts', JSON.stringify(existingOptimistic))
        }

        toast({
          title: 'Saved',
          description: editData
            ? 'Changes saved - syncing to GitHub...'
            : 'Processing in background - your data is already visible',
        })

        if (onSuccess) onSuccess(optimisticWithRealId)
        setFormData(emptyForm(schemaFields))
        setCompositionRows([emptyRow()])
        setStep(1)
        setLoading(false)

        // Background polling
        pollJobStatus(result.job_id)
          .then(finalData => {
            if (!editData) {
              const updatedOptimistic = JSON.parse(sessionStorage.getItem('optimisticProducts') || '[]')
                .filter((item: any) => {
                  if (item._jobId === result.job_id) return false
                  if (item.productId === tempProductId) return false
                  if (finalData.productId && item.productId === finalData.productId) return false
                  if (item.productName === finalData.productName && item.manufacturer === finalData.manufacturer) return false
                  return true
                })
              sessionStorage.setItem('optimisticProducts', JSON.stringify(updatedOptimistic))
            }
            sessionStorage.setItem('jobJustCompleted', Date.now().toString())
            if (onSuccess) onSuccess(finalData)
          })
          .catch(() => {
            sessionStorage.setItem('dataInvalidated', Date.now().toString())
            sessionStorage.removeItem('optimisticProducts')
          })

        return
      }

      const err = await asyncResponse.json().catch(() => ({ detail: asyncResponse.statusText }))
      throw new Error(err.detail || `HTTP ${asyncResponse.status}`)
    } catch (error) {
      toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to submit data', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  // ── Dynamic field renderer (Step 1) ────────────────────────
  const renderField = (f: SchemaField) => {
    const label = fieldLabel(f.field)
    const unit = fieldUnit(f)

    if (f.possible_values && f.possible_values.length > 0) {
      return (
        <div key={f.field} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={f.field}>{label}</Label>
            {f.description && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="inline-flex items-center">
                    <Info className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80">
                  <div className="space-y-2">
                    <h4 className="font-medium leading-none">{label}</h4>
                    <p className="text-sm text-muted-foreground">{f.description}</p>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>
          <Select value={String(formData[f.field] || '')} onValueChange={(v) => handleChange(f.field, v)}>
            <SelectTrigger>
              <SelectValue placeholder={`Select ${label}...`} />
            </SelectTrigger>
            <SelectContent>
              {f.possible_values.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    const isNumber = f.type === 'float' || f.type === 'int'

    return (
      <div key={f.field} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={f.field}>{label}{unit ? ` (${unit})` : ''}</Label>
          {f.description && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center">
                  <Info className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-2">
                  <h4 className="font-medium leading-none">{label}</h4>
                  <p className="text-sm text-muted-foreground">{f.description}</p>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
        <Input
          id={f.field}
          type={isNumber ? 'number' : 'text'}
          step={f.type === 'float' ? '0.01' : undefined}
          min={f.ge !== undefined ? f.ge : undefined}
          max={f.le !== undefined ? f.le : undefined}
          placeholder={f.example ? `e.g. ${f.example}` : `Enter ${label.toLowerCase()}`}
          value={String(formData[f.field] || '')}
          onChange={(e) => handleChange(f.field, e.target.value)}
          required
        />
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────
  if (schemaLoading) {
    return (
      <Card className="w-full max-w-3xl mx-auto">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          Loading schema...
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle>Material Data Entry</CardTitle>
        <CardDescription>
          {hasComposition
            ? `Step ${step} of 3 — ${step === 1 ? 'Material Nomenclature' : step === 2 ? 'Classification' : 'Chemical Composition'}`
            : 'Enter product information for Digital Product Passport'}
          {schemaFields.length > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">
              ({schemaFields.length} fields from schema)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* ── Input mode toggle ── */}
        {!editData && (
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => setInputMode('manual')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                inputMode === 'manual'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <PenLine className="h-3.5 w-3.5" />
              {importedFileName ? 'Check Data' : 'Manual'}
            </button>
            <button
              type="button"
              onClick={() => setInputMode('import')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                inputMode === 'import'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <FileJson className="h-3.5 w-3.5" />
              AAS Import
            </button>
          </div>
        )}

        {/* ── AAS Import drop zone ── */}
        {inputMode === 'import' && !editData ? (
          <div className="min-h-[460px] flex flex-col">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-1 flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleAasFile(file)
                  e.target.value = ''
                }}
              />
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Upload className="h-7 w-7 text-muted-foreground" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">
                  {isDragging ? 'Drop AAS JSON file here' : 'Drag & drop AAS JSON file'}
                </p>
                <p className="text-xs text-muted-foreground">
                  or click to browse — accepts the AAS export format (.json)
                </p>
              </div>
              {importedFileName && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                  <FileJson className="h-3.5 w-3.5" />
                  Imported: {importedFileName}
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
        {/* ── Step indicator ── */}
        {hasComposition && (
          <div className="flex items-center justify-between mb-5">
            <button
              type="button"
              onClick={() => setStep(1)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                step === 1
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">1</span>
              Nomenclature
            </button>
            <div className="flex-1 h-px bg-border mx-2" />
            <button
              type="button"
              onClick={() => setStep(2)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                step === 2
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">2</span>
              Classification
            </button>
            <div className="flex-1 h-px bg-border mx-2" />
            <button
              type="button"
              onClick={() => setStep(3)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                step === 3
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">3</span>
              Composition
            </button>
          </div>
        )}

        {/* ── CRMA result banner (after AAS import) ── */}
        {crmaResult && importedFileName && (
          <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 mb-4 text-sm ${
            crmaResult.crmaStatus !== 'none'
              ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50'
              : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50'
          }`}>
            {crmaResult.crmaStatus !== 'none' ? (
              <ShieldAlert className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" />
            )}
            <div className="space-y-1">
              <p className="font-medium">
                {crmaResult.crmaStatus !== 'none'
                  ? `EU CRMA: ${crmaResult.crmaStatus.replace('+', ' + ')}`
                  : 'EU CRMA: No critical or strategic raw materials detected'}
              </p>
              {crmaResult.crmaDetails.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {crmaResult.crmaDetails.map((d) => (
                    <span key={d.cas} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      d.critical
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300'
                        : 'bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300'
                    }`}>
                      {d.element} — {d.materialName}
                      {d.critical && <span className="text-[10px]">(critical)</span>}
                      {d.strategic && <span className="text-[10px]">(strategic)</span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          {/* ══ STEP 1: Material Nomenclature ══ */}
          <div className={step === 1 ? 'space-y-5 min-h-[460px] flex flex-col' : 'hidden'}>
            {editData && (
              <div className="space-y-2">
                <Label htmlFor="productId">Product-ID</Label>
                <Input id="productId" value={formData.productId} disabled className="bg-muted" />
              </div>
            )}

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" />
                Material Nomenclature
              </legend>
              <div className="space-y-4 pl-0.5">
                {nomenclatureFields.map((f) => renderField(f))}
              </div>
            </fieldset>

            {/* Any remaining ungrouped fields */}
            {otherFields.length > 0 && (
              <>
                <hr className="border-border" />
                <div className="space-y-4">
                  {otherFields.map((f) => renderField(f))}
                </div>
              </>
            )}

            <div className="flex-1" />
            {hasComposition ? (
              <Button type="button" className="w-full gap-2" onClick={() => setStep(2)}>
                Next: Classification
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" className="w-full" disabled={loading || systemStatus.backend.status === 'offline'}>
                {systemStatus.backend.status === 'offline' ? (
                  <>
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Services Offline
                  </>
                ) : loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Data'
                )}
              </Button>
            )}
          </div>

          {/* ══ STEP 2: Classification ══ */}
          {hasComposition && (
            <div className={step === 2 ? 'space-y-5 min-h-[460px] flex flex-col' : 'hidden'}>
              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <FlaskConical className="h-3.5 w-3.5" />
                  Classification
                </legend>
                <div className="space-y-4 pl-0.5">
                  {classificationFields.map((f) => renderField(f))}
                </div>
              </fieldset>

              <div className="flex-1" />
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => setStep(1)}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button type="button" className="flex-1 gap-2" onClick={() => setStep(3)}>
                  Next: Composition
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ══ STEP 3: Chemical Composition ══ */}
          {hasComposition && (
            <div className={step === 3 ? 'space-y-4 min-h-[460px] flex flex-col' : 'hidden'}>
              {/* Composition Standard & Unit */}
              {compositionHeaderFields.length > 0 && (
                <div className="grid grid-cols-2 gap-4">
                  {compositionHeaderFields.map((f) => renderField(f))}
                </div>
              )}

              <hr className="border-border" />

              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Substances ({compositionRows.length})
                </Label>
                <Button type="button" variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={addRow}>
                  <Plus className="h-3 w-3" />
                  Add Element
                </Button>
              </div>

              {/* Column header */}
              <div className="grid grid-cols-[1fr_1fr_auto_1fr_1fr_auto] gap-2 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <span>Element</span>
                <span>CAS</span>
                <span className="text-center w-16">Mode</span>
                <span>Value / Min</span>
                <span>Max</span>
                <span className="w-8" />
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {compositionRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_auto_1fr_1fr_auto] gap-2 items-center">
                    <Input
                      placeholder="e.g. Fe"
                      value={row.element}
                      onChange={(e) => updateRow(idx, { element: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      placeholder="e.g. 7439-89-6"
                      value={row.cas}
                      onChange={(e) => updateRow(idx, { cas: e.target.value })}
                      className="h-8 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => updateRow(idx, {
                        mode: row.mode === 'avg' ? 'range' : 'avg',
                        // Clear the other mode's values when switching
                        ...(row.mode === 'avg' ? { avg: '' } : { min: '', max: '' }),
                      })}
                      className={`w-16 h-8 rounded-md text-[10px] font-semibold uppercase tracking-wider border transition-colors ${
                        row.mode === 'avg'
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-orange-500/10 text-orange-600 border-orange-500/30 dark:text-orange-400'
                      }`}
                      title={row.mode === 'avg' ? 'Switch to Min/Max' : 'Switch to Average'}
                    >
                      {row.mode === 'avg' ? 'Avg' : 'Min/Max'}
                    </button>
                    {row.mode === 'avg' ? (
                      <>
                        <Input
                          type="number"
                          step="0.001"
                          placeholder="Avg %"
                          value={row.avg}
                          onChange={(e) => updateRow(idx, { avg: e.target.value })}
                          className="h-8 text-sm"
                        />
                        <Input disabled className="h-8 text-sm bg-muted" />
                      </>
                    ) : (
                      <>
                        <Input
                          type="number"
                          step="0.001"
                          placeholder="Min %"
                          value={row.min}
                          onChange={(e) => updateRow(idx, { min: e.target.value })}
                          className="h-8 text-sm"
                        />
                        <Input
                          type="number"
                          step="0.001"
                          placeholder="Max %"
                          value={row.max}
                          onChange={(e) => updateRow(idx, { max: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeRow(idx)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Navigation */}
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1 gap-2" onClick={() => setStep(2)}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button type="submit" className="flex-1" disabled={loading || systemStatus.backend.status === 'offline'}>
                  {systemStatus.backend.status === 'offline' ? (
                    <>
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Services Offline
                    </>
                  ) : loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    'Submit Data'
                  )}
                </Button>
              </div>
            </div>
          )}
        </form>
        </>
        )}
      </CardContent>
    </Card>
  )
}
