#!/usr/bin/env python3
"""Generate a standalone HTML documentation file from markdown docs and license data.

Usage:
    python scripts/generate-docs.py

Output:
    docs.html in the repository root — open directly in any browser.

Requirements:
    pip install markdown   (already in backend/venv)
"""

import json
import os
import re
import sys
from pathlib import Path

try:
    import markdown
except ImportError:
    print("ERROR: 'markdown' package not found.")
    print("Install it:  backend\\venv\\Scripts\\pip.exe install markdown")
    sys.exit(1)

ROOT_DIR = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT_DIR / "docs"
OUTPUT_FILE = ROOT_DIR / "docs.html"

# ── Collect markdown docs ────────────────────────────────────────────────────

def extract_title(content: str, filename: str) -> str:
    """Extract the first H1 heading, falling back to filename."""
    for line in content.splitlines():
        if line.startswith("# "):
            # Strip emoji shortcodes (they render poorly outside browsers with full emoji support)
            title = line[2:].strip()
            title = re.sub(r'[^\x00-\x7F]+\s*', '', title).strip()
            return title or filename.replace(".md", "").replace("-", " ").title()
    return filename.replace(".md", "").replace("-", " ").title()


def load_docs() -> list[dict]:
    docs = []
    for md_file in sorted(DOCS_DIR.glob("*.md")):
        content = md_file.read_text(encoding="utf-8")
        title = extract_title(content, md_file.name)
        html = markdown.markdown(
            content,
            extensions=["tables", "fenced_code", "toc", "sane_lists"],
        )
        docs.append({"filename": md_file.name, "title": title, "html": html})
    return docs


# ── Collect license data ─────────────────────────────────────────────────────

def load_licenses() -> tuple[list[dict], list[dict]]:
    fe_path = DOCS_DIR / "licenses-frontend.json"
    be_path = DOCS_DIR / "licenses-backend.json"

    fe_licenses = []
    if fe_path.exists():
        data = json.loads(fe_path.read_text(encoding="utf-8-sig"))
        for name, info in data.items():
            fe_licenses.append({
                "name": name,
                "license": info.get("licenses", "Unknown"),
                "source": "Frontend",
            })

    be_licenses = []
    if be_path.exists():
        data = json.loads(be_path.read_text(encoding="utf-8-sig"))
        for item in data:
            be_licenses.append({
                "name": f"{item['Name']} {item['Version']}",
                "license": item.get("License", "Unknown"),
                "source": "Backend",
            })

    return fe_licenses, be_licenses


# ── HTML template ─────────────────────────────────────────────────────────────

CSS = r"""
:root {
    --bg: #ffffff; --bg-secondary: #f8f9fa; --text: #1a1a2e;
    --text-muted: #6c757d; --border: #dee2e6; --accent: #2563eb;
    --accent-hover: #1d4ed8; --code-bg: #f1f3f5; --sidebar-bg: #f8f9fa;
    --badge-mit-bg: #d1fae5; --badge-mit-text: #065f46;
    --badge-other-bg: #dbeafe; --badge-other-text: #1e40af;
    --table-stripe: #f8f9fa; --shadow: 0 1px 3px rgba(0,0,0,.1);
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #0f172a; --bg-secondary: #1e293b; --text: #e2e8f0;
        --text-muted: #94a3b8; --border: #334155; --accent: #60a5fa;
        --accent-hover: #93c5fd; --code-bg: #1e293b; --sidebar-bg: #1e293b;
        --badge-mit-bg: #064e3b; --badge-mit-text: #6ee7b7;
        --badge-other-bg: #1e3a5f; --badge-other-text: #93c5fd;
        --table-stripe: #1e293b; --shadow: 0 1px 3px rgba(0,0,0,.4);
    }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
       font-size: 15px; line-height: 1.6; color: var(--text); background: var(--bg); }
body { display: flex; min-height: 100vh; }

/* Sidebar */
#sidebar { width: 280px; background: var(--sidebar-bg); border-right: 1px solid var(--border);
           padding: 1rem 0; position: fixed; top: 0; bottom: 0; overflow-y: auto;
           display: flex; flex-direction: column; z-index: 10; }
#sidebar h2 { font-size: 1rem; font-weight: 700; padding: 0 1rem .75rem; border-bottom: 1px solid var(--border);
              margin-bottom: .5rem; }
#sidebar-search { margin: 0 .75rem .75rem; padding: .4rem .6rem; border: 1px solid var(--border);
                  border-radius: 6px; font-size: .85rem; background: var(--bg); color: var(--text); width: calc(100% - 1.5rem); }
.nav-section { font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
               color: var(--text-muted); padding: .5rem 1rem .25rem; }
.nav-link { display: block; padding: .35rem 1rem .35rem 1.5rem; font-size: .85rem;
            color: var(--text-muted); text-decoration: none; border-left: 3px solid transparent;
            transition: all .15s; cursor: pointer; }
.nav-link:hover { background: var(--bg); color: var(--text); }
.nav-link.active { border-left-color: var(--accent); color: var(--accent); font-weight: 600; background: var(--bg); }

/* Main */
#main { margin-left: 280px; flex: 1; padding: 2rem 3rem; max-width: 960px; }
.section { display: none; }
.section.active { display: block; }

/* Typography */
.section h1 { font-size: 1.8rem; font-weight: 800; margin-bottom: 1rem; padding-bottom: .5rem; border-bottom: 2px solid var(--border); }
.section h2 { font-size: 1.35rem; font-weight: 700; margin: 1.8rem 0 .75rem; }
.section h3 { font-size: 1.1rem; font-weight: 600; margin: 1.4rem 0 .5rem; }
.section p { margin-bottom: .75rem; }
.section a { color: var(--accent); text-decoration: none; }
.section a:hover { text-decoration: underline; }
.section ul, .section ol { margin: .5rem 0 1rem 1.5rem; }
.section li { margin-bottom: .25rem; }
.section code { background: var(--code-bg); padding: .15rem .35rem; border-radius: 4px; font-size: .9em; font-family: "Cascadia Code", Consolas, monospace; }
.section pre { background: var(--code-bg); padding: 1rem; border-radius: 8px; overflow-x: auto; margin: .75rem 0 1rem; }
.section pre code { background: none; padding: 0; }
.section blockquote { border-left: 4px solid var(--accent); padding: .5rem 1rem; margin: .75rem 0; color: var(--text-muted); background: var(--bg-secondary); border-radius: 0 6px 6px 0; }
.section img { max-width: 100%; border-radius: 6px; }

/* Tables (docs) */
.section table { width: 100%; border-collapse: collapse; margin: .75rem 0 1rem; font-size: .9rem; }
.section th { background: var(--bg-secondary); font-weight: 600; text-align: left; padding: .6rem .75rem; border: 1px solid var(--border); }
.section td { padding: .5rem .75rem; border: 1px solid var(--border); }
.section tr:nth-child(even) td { background: var(--table-stripe); }
.section hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }

/* License table */
#license-table { width: 100%; border-collapse: collapse; font-size: .85rem; }
#license-table th { position: sticky; top: 0; background: var(--bg-secondary); font-weight: 600;
                    text-align: left; padding: .5rem .75rem; border-bottom: 2px solid var(--border); }
#license-table td { padding: .4rem .75rem; border-bottom: 1px solid var(--border); }
#license-table tr:nth-child(even) td { background: var(--table-stripe); }
.badge { display: inline-block; padding: .1rem .5rem; border-radius: 9999px; font-size: .75rem; font-weight: 500; }
.badge-mit { background: var(--badge-mit-bg); color: var(--badge-mit-text); }
.badge-other { background: var(--badge-other-bg); color: var(--badge-other-text); }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .75rem; margin-bottom: 1.5rem; }
.stat-card { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: .75rem 1rem; }
.stat-card .value { font-size: 1.5rem; font-weight: 700; }
.stat-card .label { font-size: .75rem; color: var(--text-muted); }
#license-search { padding: .4rem .6rem; border: 1px solid var(--border); border-radius: 6px;
                  font-size: .85rem; background: var(--bg); color: var(--text); width: 100%; max-width: 300px; margin-bottom: 1rem; }

/* Mobile */
@media (max-width: 768px) {
    #sidebar { width: 100%; position: relative; border-right: none; border-bottom: 1px solid var(--border); max-height: 40vh; }
    #main { margin-left: 0; padding: 1.5rem 1rem; }
}

/* Print */
@media print {
    #sidebar { display: none; }
    #main { margin-left: 0; }
    .section { display: block !important; page-break-before: always; }
    .section:first-child { page-break-before: avoid; }
}
"""

JS = r"""
document.addEventListener("DOMContentLoaded", function() {
    var links = document.querySelectorAll(".nav-link");
    var sections = document.querySelectorAll(".section");

    function activate(id) {
        sections.forEach(function(s) { s.classList.toggle("active", s.id === id); });
        links.forEach(function(l) { l.classList.toggle("active", l.dataset.target === id); });
        history.replaceState(null, "", "#" + id);
        window.scrollTo(0, 0);
    }

    links.forEach(function(link) {
        link.addEventListener("click", function() { activate(this.dataset.target); });
    });

    // Sidebar search
    var sidebarSearch = document.getElementById("sidebar-search");
    if (sidebarSearch) {
        sidebarSearch.addEventListener("input", function() {
            var q = this.value.toLowerCase();
            links.forEach(function(link) {
                var text = link.textContent.toLowerCase();
                link.style.display = text.includes(q) ? "" : "none";
            });
        });
    }

    // License table search
    var licSearch = document.getElementById("license-search");
    if (licSearch) {
        licSearch.addEventListener("input", function() {
            var q = this.value.toLowerCase();
            var rows = document.querySelectorAll("#license-table tbody tr");
            var shown = 0;
            rows.forEach(function(row) {
                var match = row.textContent.toLowerCase().includes(q);
                row.style.display = match ? "" : "none";
                if (match) shown++;
            });
            var counter = document.getElementById("license-count");
            if (counter) counter.textContent = shown + " of " + rows.length;
        });
    }

    // Activate section from URL hash or first doc
    var hash = location.hash.replace("#", "");
    if (hash && document.getElementById(hash)) { activate(hash); }
    else if (links.length) { activate(links[0].dataset.target); }
});
"""


def build_html(docs: list[dict], fe_licenses: list[dict], be_licenses: list[dict]) -> str:
    all_licenses = fe_licenses + be_licenses
    mit_count = sum(1 for l in all_licenses if "mit" in l["license"].lower())

    # Sidebar nav
    nav_docs = ""
    for doc in docs:
        slug = doc["filename"].replace(".md", "").lower()
        nav_docs += f'        <a class="nav-link" data-target="doc-{slug}">{doc["title"]}</a>\n'

    # Doc sections
    doc_sections = ""
    for doc in docs:
        slug = doc["filename"].replace(".md", "").lower()
        doc_sections += f'    <div id="doc-{slug}" class="section">\n{doc["html"]}\n    </div>\n'

    # License table rows
    license_rows = ""
    for lic in all_licenses:
        is_mit = "mit" in lic["license"].lower()
        badge_cls = "badge-mit" if is_mit else "badge-other"
        license_rows += (
            f'            <tr>'
            f'<td style="font-family:monospace;font-size:.85em">{lic["name"]}</td>'
            f'<td><span class="badge {badge_cls}">{lic["license"]}</span></td>'
            f'<td style="font-size:.8em;color:var(--text-muted)">{lic["source"]}</td>'
            f'</tr>\n'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>HealthTrack-X — Documentation &amp; Licenses</title>
    <style>{CSS}</style>
</head>
<body>
    <nav id="sidebar">
        <h2>HealthTrack-X</h2>
        <input id="sidebar-search" type="search" placeholder="Search pages...">
        <div class="nav-section">Documentation</div>
{nav_docs}
        <div class="nav-section">Compliance</div>
        <a class="nav-link" data-target="licenses">Licenses ({len(all_licenses)})</a>
    </nav>

    <main id="main">
{doc_sections}
        <div id="licenses" class="section">
            <h1>Dependency Licenses</h1>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="value">{len(all_licenses)}</div>
                    <div class="label">Total Dependencies</div>
                </div>
                <div class="stat-card">
                    <div class="value">{len(fe_licenses)}</div>
                    <div class="label">Frontend Packages</div>
                </div>
                <div class="stat-card">
                    <div class="value">{len(be_licenses)}</div>
                    <div class="label">Backend Packages</div>
                </div>
                <div class="stat-card">
                    <div class="value">{mit_count}</div>
                    <div class="label">MIT Licensed</div>
                </div>
            </div>
            <input id="license-search" type="search" placeholder="Search packages...">
            <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem">
                Showing <span id="license-count">{len(all_licenses)} of {len(all_licenses)}</span> packages
            </p>
            <div style="overflow-x:auto;max-height:70vh;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
                <table id="license-table">
                    <thead><tr><th>Package</th><th>License</th><th>Source</th></tr></thead>
                    <tbody>
{license_rows}
                    </tbody>
                </table>
            </div>
            <p style="margin-top:1rem;font-size:.85rem;color:var(--text-muted)">
                All dependencies use MIT or MIT-compatible licenses (ISC, BSD-2/3-Clause, Apache-2.0, CC0-1.0, 0BSD).
            </p>
        </div>
    </main>

    <script>{JS}</script>
</body>
</html>"""


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Loading documentation...")
    docs = load_docs()
    print(f"  {len(docs)} markdown files")

    print("Loading license data...")
    fe, be = load_licenses()
    print(f"  {len(fe)} frontend + {len(be)} backend packages")

    print("Generating HTML...")
    html = build_html(docs, fe, be)
    OUTPUT_FILE.write_text(html, encoding="utf-8")

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f"Done: {OUTPUT_FILE.relative_to(ROOT_DIR)} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
