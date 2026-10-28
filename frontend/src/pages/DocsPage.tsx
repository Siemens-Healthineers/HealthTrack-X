import { useState, useEffect, useMemo, useCallback, useRef, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Search, Loader2, ArrowLeft, ChevronRight, FileText } from 'lucide-react'
import htxLogoDark from '../assets/htx-logo-dark-theme.png'
import htxLogoLight from '../assets/htx-logo-light-theme.png'

// ── Known markdown docs (served as static files by nginx) ───
const DOC_FILES = [
  'GETTING-STARTED.md',
  'FEATURES.md',
  'ARCHITECTURE.md',
  'AUTHENTICATION.md',
  'TROUBLESHOOTING.md',
  'LICENSE-ANALYSIS.md',
  'DOCUMENTATION-INDEX.md',
]

interface DocEntry {
  filename: string
  title: string
  content: string
}

interface SearchHit {
  filename: string
  title: string
  snippet: string      // text around the match
  matchStart: number   // char index in snippet where match starts
}

interface TocHeading {
  id: string
  text: string
  level: number
}

// ── Helpers ─────────────────────────────────────────────────

/** Extract first H1 heading as title, fallback to filename. */
function extractTitle(content: string, filename: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      // Strip emoji
      return line.slice(2).replace(/[^\x00-\x7F]+\s*/g, '').trim() || prettifyFilename(filename)
    }
  }
  return prettifyFilename(filename)
}

function prettifyFilename(f: string): string {
  return f.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Extract ## and ### headings for TOC. */
function extractToc(content: string): TocHeading[] {
  const headings: TocHeading[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^(#{2,3})\s+(.+)/)
    if (match) {
      const text = match[2].replace(/[^\x00-\x7F]+\s*/g, '').trim()
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      if (text) headings.push({ id, text, level: match[1].length })
    }
  }
  return headings
}

/** Generate a slug for heading IDs (must match TOC generation). */
function headingId(text: string): string {
  return text
    .replace(/[^\x00-\x7F]+\s*/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Wrap search matches in <mark> for yellow highlight. */
function highlightText(children: ReactNode, query: string): ReactNode {
  if (!query || query.length < 2) return children
  const normalizedQuery = query.toLowerCase()
  if (typeof children === 'string') {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(${escaped})`, 'gi')
    const parts = children.split(regex)
    if (parts.length <= 1) return children
    return parts.map((part, i) =>
      part.toLowerCase() === normalizedQuery
        ? <mark key={i} className="bg-yellow-300/60 dark:bg-yellow-400/30 text-inherit rounded-sm px-0.5">{part}</mark>
        : part
    )
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => <span key={i}>{highlightText(child, query)}</span>)
  }
  return children
}

// ── Component ───────────────────────────────────────────────

export function DocsPage() {
  const [docs, setDocs] = useState<DocEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeDoc, setActiveDoc] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)

  // ── Load all docs on mount ──────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function loadDocs() {
      const entries: DocEntry[] = []
      const results = await Promise.allSettled(
        DOC_FILES.map(async (filename) => {
          const resp = await fetch(`/docs-md/${filename}`)
          if (!resp.ok) return null
          const content = await resp.text()
          return { filename, title: extractTitle(content, filename), content }
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) entries.push(r.value)
      }
      if (!cancelled) {
        setDocs(entries)
        setActiveDoc(entries[0]?.filename ?? null)
        setLoading(false)
      }
    }
    loadDocs()
    return () => { cancelled = true }
  }, [])

  // ── Filtered doc list ───────────────────────────────────
  const filteredDocs = useMemo(() => {
    if (!search.trim()) return docs
    const q = search.toLowerCase()
    return docs.filter(
      d => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)
    )
  }, [docs, search])

  // ── Search preview hits with context snippets ───────────
  const searchHits = useMemo((): SearchHit[] => {
    if (!search.trim() || search.length < 2) return []
    const q = search.toLowerCase()
    const hits: SearchHit[] = []
    const CONTEXT = 60 // chars around match
    const MAX_HITS_PER_DOC = 3
    const MAX_TOTAL = 12

    for (const doc of docs) {
      // Strip markdown syntax for cleaner snippets
      const plain = doc.content.replace(/[#*_`|>\[\]()!]/g, '').replace(/\n{2,}/g, '\n')
      const lower = plain.toLowerCase()
      let found = 0
      let startFrom = 0
      while (found < MAX_HITS_PER_DOC && hits.length < MAX_TOTAL) {
        const idx = lower.indexOf(q, startFrom)
        if (idx === -1) break
        const snippetStart = Math.max(0, idx - CONTEXT)
        const snippetEnd = Math.min(plain.length, idx + q.length + CONTEXT)
        const snippet = (snippetStart > 0 ? '…' : '') +
          plain.slice(snippetStart, snippetEnd).replace(/\n/g, ' ').trim() +
          (snippetEnd < plain.length ? '…' : '')
        hits.push({
          filename: doc.filename,
          title: doc.title,
          snippet,
          matchStart: idx - snippetStart + (snippetStart > 0 ? 1 : 0),
        })
        startFrom = idx + q.length
        found++
      }
    }
    return hits
  }, [docs, search])

  // ── Close search preview on click outside ───────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // ── Active doc content ──────────────────────────────────
  const currentDoc = useMemo(
    () => docs.find(d => d.filename === activeDoc) ?? null,
    [docs, activeDoc]
  )

  const toc = useMemo(
    () => (currentDoc ? extractToc(currentDoc.content) : []),
    [currentDoc]
  )

  // ── IntersectionObserver for active TOC heading ─────────
  useEffect(() => {
    const container = contentRef.current
    if (!container || toc.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHeading(entry.target.id)
            break
          }
        }
      },
      { root: container, rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    )

    // Small delay so headings are rendered
    const timer = setTimeout(() => {
      const headingEls = container.querySelectorAll('h2[id], h3[id]')
      headingEls.forEach(el => observer.observe(el))
    }, 100)

    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [currentDoc, toc])

  // ── Select doc handler ──────────────────────────────────
  const selectDoc = useCallback((filename: string) => {
    setActiveDoc(filename)
    setActiveHeading(null)
    contentRef.current?.scrollTo({ top: 0 })
  }, [])

  // ── Select search hit handler ───────────────────────────
  const selectHit = useCallback((hit: SearchHit) => {
    setActiveDoc(hit.filename)
    setActiveHeading(null)
    setSearchFocused(false)
    // Scroll to first highlight after doc renders
    setTimeout(() => {
      const firstMark = contentRef.current?.querySelector('mark')
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 200)
  }, [])

  // ── Scroll to heading ───────────────────────────────────
  const scrollToHeading = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveHeading(id)
    }
  }, [])

  // ── Custom heading renderers (add ids for anchor links) ─
  const markdownComponents = useMemo(() => ({
    h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
      const text = String(children)
      return <h1 id={headingId(text)} {...props}>{highlightText(children, search)}</h1>
    },
    h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
      const text = String(children)
      return <h2 id={headingId(text)} {...props}>{highlightText(children, search)}</h2>
    },
    h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
      const text = String(children)
      return <h3 id={headingId(text)} {...props}>{highlightText(children, search)}</h3>
    },
    // Highlight in paragraphs, list items, table cells
    p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p {...props}>{highlightText(children, search)}</p>
    ),
    li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
      <li {...props}>{highlightText(children, search)}</li>
    ),
    strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <strong {...props}>{highlightText(children, search)}</strong>
    ),
    em: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
      <em {...props}>{highlightText(children, search)}</em>
    ),
    // Style code blocks
    pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
      <pre className="bg-muted/50 border border-border rounded-lg p-4 overflow-x-auto text-sm" {...props}>
        {children}
      </pre>
    ),
    code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
      // Inline code (no className from fenced blocks)
      if (!className) {
        return (
          <code className="bg-muted/60 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
            {highlightText(children, search)}
          </code>
        )
      }
      return <code className={className} {...props}>{children}</code>
    },
    // Style tables
    table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-border text-sm" {...props}>
          {children}
        </table>
      </div>
    ),
    th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <th className="border border-border bg-muted/40 px-3 py-2 text-left font-semibold" {...props}>
        {highlightText(children, search)}
      </th>
    ),
    td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
      <td className="border border-border px-3 py-2" {...props}>
        {highlightText(children, search)}
      </td>
    ),
    // Style links
    a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        className="text-primary hover:underline"
        target={href?.startsWith('http') ? '_blank' : undefined}
        rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
        {...props}
      >
        {highlightText(children, search)}
      </a>
    ),
  }), [search])

  // ── Scroll to first highlight after search changes ───
  useEffect(() => {
    if (!search || search.length < 2) return
    const timer = setTimeout(() => {
      const firstMark = contentRef.current?.querySelector('mark')
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [search, activeDoc])

  // ── Loading state ───────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* ── Top Navbar (previous style restored) ─────────── */}
      <header className="h-16 flex-shrink-0 border-b border-border bg-background flex items-center px-6 gap-5">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <img src={htxLogoLight} alt="HTX" className="h-9 flex-shrink-0 dark:hidden" />
          <img src={htxLogoDark} alt="HTX" className="h-9 flex-shrink-0 hidden dark:block" />
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Title */}
        <span className="text-base font-semibold text-foreground">Documentation</span>

        {/* Centered Search */}
        <div className="flex-1 flex justify-center">
          <div ref={searchRef} className="relative w-full max-w-2xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search all documents…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchFocused(true) }}
              onFocus={() => setSearchFocused(true)}
              className="w-full pl-10 pr-3 py-2 text-sm rounded-md border border-border bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#02CCB9]/40 focus:bg-background"
            />

            {/* ── Search Preview Dropdown ──────────────── */}
            {searchFocused && searchHits.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-50 max-h-[24rem] overflow-y-auto">
                <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground">
                  {searchHits.length} result{searchHits.length !== 1 ? 's' : ''} found
                </div>
                {searchHits.map((hit, i) => {
                  const q = search.toLowerCase()
                  const snippetLower = hit.snippet.toLowerCase()
                  const idx = snippetLower.indexOf(q)
                  return (
                    <button
                      key={`${hit.filename}-${i}`}
                      onClick={() => selectHit(hit)}
                      className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-b-0"
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText className="h-3 w-3 text-[#02CCB9] flex-shrink-0" />
                        <span className="text-xs font-medium text-[#02CCB9] truncate">{hit.title}</span>
                      </div>
                      <p className="text-xs text-foreground/70 leading-relaxed line-clamp-2">
                        {idx >= 0 ? (
                          <>
                            {hit.snippet.slice(0, idx)}
                            <mark className="bg-yellow-300/60 dark:bg-yellow-400/30 text-inherit rounded-sm px-0.5">
                              {hit.snippet.slice(idx, idx + q.length)}
                            </mark>
                            {hit.snippet.slice(idx + q.length)}
                          </>
                        ) : hit.snippet}
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
            {searchFocused && search.length >= 2 && searchHits.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-50 px-3 py-4 text-center text-sm text-muted-foreground">
                No results found for &ldquo;{search}&rdquo;
              </div>
            )}
          </div>
        </div>

        {/* Back to App */}
        <a
          href="/"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to App
        </a>
      </header>

      {/* ── Body ─────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">
        {/* ── Left Sidebar ───────────────────────────────── */}
        <aside className="w-[16rem] flex-shrink-0 border-r border-border bg-background overflow-y-auto">
          <nav className="py-3">
            {filteredDocs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground text-center">No documents found.</p>
            ) : (
              filteredDocs.map(doc => (
                <button
                  key={doc.filename}
                  onClick={() => selectDoc(doc.filename)}
                  className={`w-full text-left px-4 py-2.5 text-[15px] leading-normal transition-colors
                    ${activeDoc === doc.filename
                      ? 'text-[#02CCB9] font-semibold bg-[#02CCB9]/5'
                      : 'text-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                >
                  <span className="flex items-center gap-2">
                    {activeDoc === doc.filename && <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                    <span className={`truncate ${activeDoc !== doc.filename ? 'ml-[22px]' : ''}`}>{doc.title}</span>
                  </span>
                </button>
              ))
            )}
          </nav>
        </aside>

        {/* ── Main Content ─────────────────────────────── */}
        <main
          ref={contentRef}
          className="flex-1 overflow-y-auto min-w-0"
        >
          {currentDoc ? (
            <div className="flex justify-center">
              <article className="w-full max-w-[60rem] px-10 py-10 prose dark:prose-invert
                prose-headings:text-foreground prose-headings:font-semibold
                prose-h1:text-[1.6rem] prose-h1:border-b prose-h1:border-border prose-h1:pb-2 prose-h1:mb-6
                prose-h2:text-[1.25rem] prose-h2:mt-10 prose-h2:mb-4
                prose-h3:text-[1.05rem] prose-h3:mt-8 prose-h3:mb-3
                prose-p:text-foreground/85 prose-p:leading-relaxed
                prose-strong:text-foreground prose-li:text-foreground/85
                prose-a:text-[#02CCB9] prose-a:no-underline hover:prose-a:underline
                prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none
                prose-headings:scroll-mt-4">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {currentDoc.content}
                </ReactMarkdown>
              </article>

              {/* ── Right TOC (inside content scroll) ──── */}
              {toc.length > 0 && (
                <aside className="w-[14rem] flex-shrink-0 hidden xl:block sticky top-0 self-start py-10 pr-4">
                  <h4 className="text-sm font-bold text-foreground uppercase tracking-widest mb-4 pl-3">
                    Table of contents
                  </h4>
                  <nav className="border-l border-border">
                    {toc.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => scrollToHeading(h.id)}
                        className={`block w-full text-left text-sm leading-relaxed py-1.5 transition-colors truncate
                          ${h.level === 3 ? 'pl-6' : 'pl-3'}
                          ${activeHeading === h.id
                            ? 'text-[#02CCB9] font-medium border-l-2 border-[#02CCB9] -ml-px'
                            : 'text-foreground/90 hover:text-foreground'
                          }`}
                        title={h.text}
                      >
                        {h.text}
                      </button>
                    ))}
                  </nav>
                </aside>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Select a document from the sidebar.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default DocsPage
