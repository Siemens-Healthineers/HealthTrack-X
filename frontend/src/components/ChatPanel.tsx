/**
 * ChatPanel — slide-out AI assistant overlay.
 *
 * Opens from the right edge of the screen as a non-displacing overlay.
 * Connected to the local Ollama LLM via the backend /api/chat endpoint.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X, Send, Bot, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/config/api'
import { useAppProfile } from '@/contexts/AppProfileContext'
import { notifyMutationPreviewCreated } from '@/lib/mutationEvents'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatPanelProps {
  open: boolean
  onClose: () => void
}

const USE_CASE_LABELS: Record<string, string> = {
  'raw-material': 'Raw Material (ROH)',
  'semi-finished-good': 'Semi-finished Good (HALB)',
  'finished-product': 'Finished Product (FERT)',
  'medical-device': 'Medical Device (END)',
}

const WELCOME_EXAMPLES: Record<string, string> = {
  'raw-material':
    '> *"Create a new product: Hydro REDUXA 4.0, manufacturer Hydro ASA, ' +
    'material EN AB-42100, 75% recycled content, weight 10 kg, ' +
    'CO\u2082 4.0 kg, method ISO 14067"*',
  'semi-finished-good':
    '> *"Show material HC0000000260 — X5CrNi18-10 (1.4301) with its chemical composition"*\n\n' +
    'This use case stores material data for semi-finished goods (HALB) including ' +
    'nomenclature, classification (IEC 62474) and chemical composition (VDA 231-301).',
}

const ACTION_BLOCK_RE = /\s*<action>[\s\S]*?<\/action>\s*/gi

function mutationReviewNotice(content: string) {
  const cleaned = content
    .replace(ACTION_BLOCK_RE, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const notice = 'I prepared a data-change preview. Please review it in the approval dialog.'
  return cleaned ? `${cleaned}\n\n${notice}` : notice
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const { appProfile, configId, dataFolder } = useAppProfile()
  const activeUseCase = USE_CASE_LABELS[appProfile] || appProfile

  const welcomeText = useMemo(() => (
    'Hello! I\'m the HealthTrack-X AI Assistant.\n\n' +
    'I can help you manage product records for the Digital Product Passport. ' +
    'For example, you can say:\n\n' +
    (WELCOME_EXAMPLES[appProfile] || WELCOME_EXAMPLES['raw-material']) +
    '\n\nYou can also ask me to list products or show the expected fields.'
  ), [appProfile])

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: welcomeText,
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollFrameRef = useRef<number | null>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!open) return
    if (scrollFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior: isLoading ? 'auto' : 'smooth',
        block: 'end',
      })
      scrollFrameRef.current = null
    })
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
        scrollFrameRef.current = null
      }
    }
  }, [messages, isLoading, open])

  // Update welcome message when profile changes
  useEffect(() => {
    setMessages(prev => prev.map(m =>
      m.id === 'welcome' ? { ...m, content: welcomeText } : m
    ))
  }, [welcomeText])

  // Focus input when panel opens
  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 300)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  // Build the message history for the backend (last 10 messages to limit context)
  const buildApiMessages = useCallback(
    (extraUser: string) => {
      const allMsgs = [
        ...messages.filter(m => m.id !== 'welcome'),
        { role: 'user' as const, content: extraUser },
      ]
      return allMsgs.slice(-10).map(({ role, content }) => ({ role, content }))
    },
    [messages],
  )

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)

    const assistantId = `asst-${Date.now()}`

    try {
      // Try streaming endpoint first
      const resp = await apiFetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: buildApiMessages(text),
          config_id: configId,
          data_folder: dataFolder,
          ui_context: {
            active_use_case: activeUseCase,
            app_profile: appProfile,
          },
        }),
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: resp.statusText }))
        throw new Error(body.detail || `HTTP ${resp.status}`)
      }

      // Add empty assistant message we'll update token-by-token
      setMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }])

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No readable stream')

      const decoder = new TextDecoder()
      let buffer = ''
      let toolRunning = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Process complete SSE lines
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))

            if (evt.type === 'token') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + evt.content } : m,
              ))
            } else if (evt.type === 'mutation_preview') {
              notifyMutationPreviewCreated(evt.approval_id)
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: mutationReviewNotice(m.content) }
                  : m,
              ))
            } else if (evt.type === 'tool') {
              if (evt.status === 'running') {
                toolRunning = evt.name
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: m.content + `\n🔧 Running ${evt.name}…` }
                    : m,
                ))
              } else if (evt.status === 'done' && toolRunning) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: m.content.replace(`\n🔧 Running ${toolRunning}…`, '') }
                    : m,
                ))
                toolRunning = ''
              }
            } else if (evt.type === 'done') {
              // The central MutationApprovalDialog owns approve/commit and cache invalidation.
            } else if (evt.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: evt.content } : m,
              ))
            }
          } catch { /* skip malformed SSE line */ }
        }
      }

      // Clean up empty assistant message if nothing was received
      setMessages(prev => {
        const msg = prev.find(m => m.id === assistantId)
        if (msg && !msg.content.trim()) {
          return prev.map(m => m.id === assistantId ? { ...m, content: '(no response)' } : m)
        }
        return prev
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setMessages(prev => {
        // If we already added an empty assistant msg, update it; otherwise add error
        const hasAssistant = prev.some(m => m.id === assistantId)
        if (hasAssistant) {
          return prev.map(m =>
            m.id === assistantId
              ? { ...m, content: `⚠️ Could not reach the AI assistant.\n\n${errMsg}` }
              : m,
          )
        }
        return [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant' as const,
          content: `⚠️ Could not reach the AI assistant.\n\n${errMsg}`,
          timestamp: new Date(),
        }]
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:bg-transparent"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[420px] max-w-full z-50
          bg-background border-l shadow-2xl
          transform transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}
          flex flex-col`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Assistant</h3>
              <p className="text-xs text-muted-foreground">Local AI · Ollama</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="h-7 w-7 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div className="max-w-[85%] flex flex-col gap-2">
                {msg.content && (
                  <div
                    className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {msg.content}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-2 justify-start">
              <div className="h-7 w-7 rounded-full bg-primary/10 flex-shrink-0 flex items-center justify-center mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-muted rounded-xl px-3 py-2 text-sm text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t px-4 py-3">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the product to create..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            Powered by local LLM · changes require approval
          </p>
        </div>
      </div>
    </>
  )
}
