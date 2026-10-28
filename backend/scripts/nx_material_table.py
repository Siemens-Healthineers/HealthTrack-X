# ==============================================================================
# Siemens NX Open Python — Werkstofftabelle in Zeichnung erzeugen
# ==============================================================================
# Liest aus dem zugrunde liegenden Design (Master-Modell) die Attribute
#   [SH 3D-ModelRevision] Material Name[0]   -> Hauptwerkstoff
#   [SH 3D-ModelRevision] Material Number[0] -> Nummer des Hauptwerkstoffs (optional)
#   [SH 3D-ModelRevision] Alternate Material Name[0-10] -> Spalte 1
#   [SH 3D-ModelRevision] Alternate Material Number[0-10] -> Spalte 2
# und erzeugt auf dem aktuellen Zeichnungsblatt eine Tabelle mit 2 Spalten.
# - Titelzeile "Alternate Material Table" ueber beide Spalten
# - Spalten: "Material Name" und "Number | Norm | Standard"
# - Doppelte Bezeichnungen werden entfernt (Reihenfolge bleibt erhalten)
# - Alternative Standards: Text nach dem ersten "|", ohne "|" der gesamte Wert
# - Alternative Nummern werden ueber den Materialnamen vor "|" zugeordnet
# - Ohne "|" erfolgt die Zuordnung ueber den Attributindex
#
# Ausführen: Datei der Zeichnung öffnen -> Werkzeuge -> Journal -> Wiedergabe
# ==============================================================================

import re
import NXOpen
import NXOpen.Annotations
import NXOpen.UF

# --- Konfiguration ------------------------------------------------------------
# Kategorie-Namen (Teamcenter-Form). None/leer = Kategorie ignorieren.
CATEGORIES = ["SH 3D-ModelRevision", "SH 3D ModelRevision", "SH3D_ModelRevision", "SH4_ModelRevision"]
TITLE_MATERIAL = "Material Name"
TITLE_MATERIAL_NUMBER = "Material Number"
TITLE_ALT_NAME = "Alternate Material Name"
TITLE_ALT_NUMBER = "Alternate Material Number"
MAX_INDEX = 10
MAX_INDEX_BY_TITLE = {TITLE_MATERIAL: 0, TITLE_MATERIAL_NUMBER: 0}

# Trennzeichen, falls ein String mehrere Werte enthält -> nur erster Wert
VALUE_SEPARATORS = r"[;|\n\r]"

TABLE_TITLE = "Alternate Material Table"
HEADER_TEXT = ["Material Name", "Number | Norm | Standard"]  # None = keine Kopfzeile
COLUMN_WIDTHS = [80.0, 60.0]   # mm
ROW_HEIGHT = 8.0               # mm
DEFAULT_ORIGIN = NXOpen.Point3d(20.0, 280.0, 0.0)  # falls keine Position gewählt
DEBUG = False                  # listet alle "Material"-Attribute im Listing-Fenster
# ------------------------------------------------------------------------------

_INVALID = {"", "none", "--", "-", "n/a"}


def _norm(s):
    return re.sub(r"[\s_]+", "", (s or "")).lower()


_CATS = {_norm(c) for c in (CATEGORIES or []) if c}


def _category_ok(cat):
    return not _CATS or _norm(cat) in _CATS


def _first_value(val):
    if val is None:
        return ""
    first = re.split(VALUE_SEPARATORS, str(val).strip())[0].strip()
    return "" if first.lower() in _INVALID else first


def _parse_title(title):
    """Liefert (Basis-Titel, Index aus Titel oder None), z.B. 'X (3)' / 'X[3]' / 'X 3'."""
    m = re.match(r"^(.*?)\s*[\(\[]?\s*(\d+)\s*[\)\]]?\s*$", title or "")
    if m and m.group(1):
        return m.group(1).strip(), int(m.group(2))
    return (title or "").strip(), None


def get_design_part(drawing_part):
    """Master-Modell der Zeichnung (erste Komponente), sonst das Teil selbst."""
    try:
        root = drawing_part.ComponentAssembly.RootComponent
        if root:
            for comp in root.GetChildren():
                proto = comp.Prototype
                if isinstance(proto, NXOpen.Part):
                    return proto
    except Exception:
        pass
    return drawing_part


def _attr_value(part, a, idx):
    if a.Type == NXOpen.NXObject.AttributeType.String:
        return a.StringValue or ""
    try:
        return part.GetUserAttributeAsString(
            a.Title, a.Type, idx if getattr(a, "Array", False) else -1) or ""
    except Exception:
        return ""


def collect_arrays(part, titles, lw=None):
    """Liefert {Titel: {Index: Wert}} fuer die gewuenschten Array-Attribute."""
    wanted = {_norm(t): t for t in titles}
    if TITLE_ALT_NUMBER in titles:
        wanted[_norm("Alternate Material Number Standards")] = TITLE_ALT_NUMBER
    entries = {t: {} for t in titles}

    for a in part.GetUserAttributes():
        cat = getattr(a, "Category", "")
        title = getattr(a, "Title", "")
        is_array = getattr(a, "Array", False)
        idx = getattr(a, "ArrayElementIndex", None) if is_array else None

        if DEBUG and lw and "material" in title.lower():
            lw.WriteLine(f"  [DEBUG] [{cat}] '{title}' Typ={a.Type} Array={is_array} "
                         f"Index={idx} Wert='{_attr_value(part, a, idx)}'")

        if not _category_ok(cat):
            continue

        base, title_idx = _parse_title(title)
        key = wanted.get(_norm(base))
        if key is None:
            continue
        if idx is None:
            idx = title_idx if title_idx is not None else 0
        if idx > MAX_INDEX_BY_TITLE.get(key, MAX_INDEX):
            continue

        value = _attr_value(part, a, idx)
        if key == TITLE_ALT_NUMBER:
            value = value.strip()
            if value.lower() in _INVALID:
                value = ""
        else:
            value = _first_value(value)
        if value:
            entries[key][idx] = value

    return entries


def build_rows(part, lw=None):
    data = collect_arrays(
        part, [TITLE_MATERIAL, TITLE_MATERIAL_NUMBER, TITLE_ALT_NAME, TITLE_ALT_NUMBER], lw)
    name = data[TITLE_MATERIAL].get(0, "")
    number = data[TITLE_MATERIAL_NUMBER].get(0, "")
    alt_names = data[TITLE_ALT_NAME]
    alt_numbers = data[TITLE_ALT_NUMBER]

    main_row = [name, number] if name or number else None
    rows = [main_row] if main_row is not None else []
    row_by_name = {name.casefold(): main_row} if name else {}
    for i in sorted(alt_names):
        name = alt_names[i]
        if name.casefold() not in row_by_name:
            row = [name, ""]
            rows.append(row)
            row_by_name[name.casefold()] = row

    seen = set()
    for i in sorted(alt_numbers):
        prefix, separator, suffix = alt_numbers[i].partition("|")
        name = prefix.strip() if separator else alt_names.get(i, "")
        number = suffix.strip() if separator else prefix.strip()
        if number.lower() in _INVALID:
            continue
        pair = (name.casefold(), number.casefold())
        if pair in seen:
            continue
        seen.add(pair)
        existing = row_by_name.get(name.casefold()) if name else None
        if existing is not None:
            # Die Hauptwerkstoffnummer stammt ausschliesslich aus Material Number.
            if not existing[1] and existing is not main_row:
                existing[1] = number
            elif number.casefold() != existing[1].casefold():
                rows.append(["", number])
        else:
            rows.append(["", number])
            if lw:
                lw.WriteLine(
                    f"[WARNUNG] {TITLE_ALT_NUMBER}[{i}]: Kein Materialname "
                    f"fuer '{name}' gefunden; Nummer separat eingetragen.")
    return [tuple(r) for r in rows]


def pick_origin(ui):
    try:
        resp, _view, point = ui.SelectionManager.SelectScreenPosition(
            "Position der Werkstofftabelle wählen (oben links)")
        if resp == NXOpen.Selection.DialogResponse.Pick:
            return point
    except Exception:
        pass
    return DEFAULT_ORIGIN


def create_table(part, rows, origin):
    builder = part.Annotations.TableSections.CreateTableSectionBuilder(
        NXOpen.Annotations.TableSection.Null)
    try:
        builder.NumberOfColumns = len(COLUMN_WIDTHS)
        builder.NumberOfRows = len(rows) + 1
        builder.ColumnWidth = COLUMN_WIDTHS[0]
        builder.RowHeight = ROW_HEIGHT
        builder.Origin.Anchor = NXOpen.Annotations.OriginBuilder.AlignmentPosition.TopLeft
        builder.Origin.OriginPoint = origin
        section = builder.Commit()
    finally:
        builder.Destroy()

    uf = NXOpen.UF.UFSession.GetUFSession()
    tabnote = uf.Tabnot.AskTabularNoteOfSection(section.Tag)
    cols = []
    for c, width in enumerate(COLUMN_WIDTHS):
        col = uf.Tabnot.AskNthColumn(tabnote, c)
        uf.Tabnot.SetColumnWidth(col, width)
        cols.append(col)
    title_row = uf.Tabnot.AskNthRow(tabnote, 0)
    title_cell = uf.Tabnot.AskCellAtRowCol(title_row, cols[0])
    title_end_cell = uf.Tabnot.AskCellAtRowCol(title_row, cols[-1])
    uf.Tabnot.MergeCells(title_cell, title_end_cell)
    uf.Tabnot.SetCellText(title_cell, TABLE_TITLE)
    for r, values in enumerate(rows, start=1):
        row = uf.Tabnot.AskNthRow(tabnote, r)
        for col, text in zip(cols, values):
            if text:
                cell = uf.Tabnot.AskCellAtRowCol(row, col)
                uf.Tabnot.SetCellText(cell, text)
    return section


def main():
    session = NXOpen.Session.GetSession()
    ui = NXOpen.UI.GetUI()
    lw = session.ListingWindow
    lw.Open()

    work = session.Parts.Work
    if work is None:
        lw.WriteLine("[FEHLER] Kein aktives Teil.")
        return
    if work.DrawingSheets.CurrentDrawingSheet is None:
        lw.WriteLine("[FEHLER] Kein aktives Zeichnungsblatt.")
        return

    design = get_design_part(work)
    lw.WriteLine(f"Design: {design.Leaf}")

    rows = build_rows(design, lw)
    if not rows:
        lw.WriteLine("[HINWEIS] Keine Werkstoffbezeichnungen gefunden.")
        return
    for name, number in rows:
        lw.WriteLine(f"  - {name:<40} {number}")

    if HEADER_TEXT:
        rows.insert(0, tuple(HEADER_TEXT))
    origin = pick_origin(ui)

    mark = session.SetUndoMark(NXOpen.Session.MarkVisibility.Visible, "Werkstofftabelle")
    try:
        create_table(work, rows, origin)
        lw.WriteLine(f"Tabelle mit {len(rows) + 1} Zeile(n) erzeugt.")
    except Exception as e:
        session.UndoToMark(mark, "Werkstofftabelle")
        lw.WriteLine(f"[FEHLER] {e}")
        raise


if __name__ == "__main__":
    main()
