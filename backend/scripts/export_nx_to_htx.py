# ==============================================================================
# Siemens NX Open Python — HealthTrack-X Baugruppen- & Material-Extraktor
# ==============================================================================
# Inklusive:
#   - Nativem NX Progress Bar (UF_UI_create_progress_bar / LockProgress)
#   - High-Speed Extraktion (Occurrence Attribute Lookup direkt ohne EnsurePartLoaded)
#   - Status-Anzeige in der NX Statusleiste
#   - Massen in kg ([Materials] NX_Mass / NX_MassPropRollupMass)
#   - Materialien ([SH4_ModelRevision] Material Name / [Materials] NX_Material)
# ==============================================================================
# In Siemens NX ausführen: Menü -> Werkzeuge -> Journal -> Wiedergabe (Play)
# ==============================================================================

import json
import traceback
import urllib.request
import NXOpen
import NXOpen.UF

def get_comp_attributes_dict(comp):
    attrs = {}
    if not comp:
        return attrs
    try:
        for a in comp.GetUserAttributes():
            title = (getattr(a, 'Title', '') or '').strip()
            cat = (getattr(a, 'Category', '') or '').strip()
            val = ""
            try:
                val = str(a.StringValue)
            except Exception:
                try:
                    val = str(a.RealValue)
                except Exception:
                    try:
                        val = str(a.IntegerValue)
                    except Exception:
                        val = str(a)

            if val and val.strip() and val.lower() != "none" and val != "--":
                val = val.strip()
                if title:
                    attrs[title] = val
                    if cat:
                        attrs[f"{cat} > {title}"] = val
                        attrs[f"[{cat}] {title}"] = val
    except Exception:
        pass
    return attrs

def extract_material_name(attrs):
    for key, val in attrs.items():
        if "material name" in key.lower():
            if "100cr6" in val.lower() or "din" in val.lower() or "iso" in val.lower():
                return val
            if val and len(val) > 2:
                return val

    if "[Materials] NX_Material" in attrs:
        v = attrs["[Materials] NX_Material"]
        if ":" in v:
            v = v.split(":")[-1]
        return v
    if "NX_Material" in attrs:
        v = attrs["NX_Material"]
        if ":" in v:
            v = v.split(":")[-1]
        return v

    if "IMM_Material" in attrs:
        v = attrs["IMM_Material"]
        if "-" in v:
            return v.split("-")[-1]
        return v

    return "Not Assigned"

def extract_mass_kg(attrs):
    if "[Materials] NX_Mass" in attrs:
        try:
            m = float(attrs["[Materials] NX_Mass"])
            if m > 0:
                return m
        except Exception:
            pass
    if "NX_Mass" in attrs:
        try:
            m = float(attrs["NX_Mass"])
            if m > 0:
                return m
        except Exception:
            pass

    if "[Rolled-Up Mass Properties] NX_MassPropRollupMass" in attrs:
        try:
            m = float(attrs["[Rolled-Up Mass Properties] NX_MassPropRollupMass"])
            if m > 0:
                return m
        except Exception:
            pass
    if "NX_MassPropRollupMass" in attrs:
        try:
            m = float(attrs["NX_MassPropRollupMass"])
            if m > 0:
                return m
        except Exception:
            pass

    return 0.0

def collect_all_components(comp):
    """Sammelt alle Komponenten der Baugruppe flach für Zählung und Progress Bar."""
    comps = []
    pending = [comp]
    while pending:
        current = pending.pop()
        comps.append(current)
        children = list(current.GetChildren())
        pending.extend(reversed(children))
    return comps

def process_single_component(comp, parent_id, depth):
    """Verarbeitet eine einzelne Komponente ultra-schnell."""
    comp_name = comp.DisplayName if comp.DisplayName else "Component"
    part_num = comp.Name if comp.Name else comp_name
    node_id = "NX-" + str(comp.Tag)

    children = comp.GetChildren()
    is_assembly = len(children) > 0

    model_type = "NX Root Assembly" if (depth == 0 and is_assembly) else (
        "NX Subassembly" if is_assembly else "NX Component"
    )

    attrs = get_comp_attributes_dict(comp)

    if "Product Name" in attrs:
        comp_name = attrs["Product Name"]
    elif "SH_DescriptivePartName" in attrs:
        comp_name = attrs["SH_DescriptivePartName"]
    elif "DB_PART_NAME" in attrs:
        comp_name = attrs["DB_PART_NAME"]

    if "DisplayID" in attrs:
        part_num = attrs["DisplayID"]
    elif "SAP_ID" in attrs:
        part_num = attrs["SAP_ID"]

    material_name = extract_material_name(attrs)
    mass_kg = extract_mass_kg(attrs)

    volume = None
    if "[Materials] NX_Volume" in attrs:
        try: volume = float(attrs["[Materials] NX_Volume"])
        except Exception: pass

    area = None
    if "[Materials] NX_Area" in attrs:
        try: area = float(attrs["[Materials] NX_Area"])
        except Exception: pass

    density = None
    if "[Materials] NX_Density" in attrs:
        try:
            d_val = float(attrs["[Materials] NX_Density"])
            density = round(d_val * 1000000.0, 2) if d_val < 0.1 else round(d_val, 2)
        except Exception: pass

    return {
        "productId": node_id,
        "nodeId": node_id,
        "name": comp_name,
        "partNumber": part_num,
        "parentId": parent_id,
        "modelType": model_type,
        "quantity": 1,
        "materialName": material_name,
        "weight": str(round(mass_kg, 4)) if mass_kg > 0 else "0.0",
        "weightUnit": "kg",
        "density": density,
        "volume": volume,
        "surfaceArea": area,
        "nxAttributes": attrs,
        "depth": depth
    }

def process_tree_with_progress(comp, parent_id, depth, state, theUFSession):
    """Durchläuft den Baum und aktualisiert den NX-Fortschrittsbalken."""
    nodes = []
    pending = [(comp, parent_id, depth)]
    while pending:
        current, current_parent_id, current_depth = pending.pop()
        node_data = process_single_component(current, current_parent_id, current_depth)
        nodes.append(node_data)

        state["current"] += 1
        if state["current"] == 1 or state["current"] % 25 == 0 or state["current"] == state["total"]:
            pct = int((state["current"] / float(state["total"])) * 100) if state["total"] > 0 else 0
            msg = f"Exportiere {state['current']}/{state['total']}: {node_data['name'][:30]}"
            try:
                theUFSession.Ui.SetPrompt(msg)
                theUFSession.Ui.SetStatus(f"HealthTrack-X Export: {pct}% ({state['current']}/{state['total']})")
            except Exception:
                pass

        children = list(current.GetChildren())
        for child in reversed(children):
            pending.append((child, node_data["nodeId"], current_depth + 1))

    return nodes

def rollup_masses(nodes):
    """Summiert die Massen der Kindknoten für Baugruppen auf."""
    node_map = {n["nodeId"]: n for n in nodes}
    for n in reversed(nodes):
        if n.get("parentId") and n["parentId"] in node_map:
            p = node_map[n["parentId"]]
            child_mass = float(n.get("weight") or 0.0)
            parent_mass = float(p.get("weight") or 0.0)
            p["weight"] = str(round(parent_mass + child_mass, 4))

def main():
    theSession = NXOpen.Session.GetSession()
    theUFSession = NXOpen.UF.UFSession.GetUFSession()

    work_part = theSession.Parts.Work
    if not work_part:
        theUFSession.Ui.DisplayMessage("Kein aktives Work Part in Siemens NX geöffnet!", 1)
        return

    root_comp = work_part.ComponentAssembly.RootComponent

    if root_comp:
        # 1. Schnelle Zählung der Bauteile
        theUFSession.Ui.SetStatus("Analysiere Baugruppenstruktur...")
        all_comps = collect_all_components(root_comp)
        total_count = len(all_comps)

        # 2. Progress Bar initialisieren
        try:
            theUFSession.Ui.LockUgAccess(NXOpen.UF.UFConstants.UF_UI_FROM_CUSTOM)
        except Exception:
            pass

        state = {"current": 0, "total": total_count}

        try:
            bom_nodes = process_tree_with_progress(root_comp, None, 0, state, theUFSession)
            rollup_masses(bom_nodes)
        finally:
            try:
                theUFSession.Ui.UnlockUgAccess(NXOpen.UF.UFConstants.UF_UI_FROM_CUSTOM)
            except Exception:
                pass
    else:
        attrs = get_comp_attributes_dict(work_part)
        mat = extract_material_name(attrs)
        mass = extract_mass_kg(attrs)
        bom_nodes = [{
            "productId": "NX-" + str(work_part.Tag),
            "nodeId": "NX-" + str(work_part.Tag),
            "name": work_part.Leaf,
            "partNumber": work_part.Leaf,
            "parentId": None,
            "modelType": "NX Component",
            "quantity": 1,
            "materialName": mat,
            "weight": str(round(mass, 4)) if mass > 0 else "0.0",
            "weightUnit": "kg",
            "nxAttributes": attrs,
            "depth": 0
        }]

    # 3. HTTP Push zu HealthTrack-X
    theUFSession.Ui.SetStatus(f"Sende {len(bom_nodes)} Komponenten an HealthTrack-X...")
    json_bytes = json.dumps(bom_nodes, indent=2).encode('utf-8')
    req = urllib.request.Request(
        "http://htx.local/api/nx/assembly",
        data=json_bytes,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    pushed = False
    last_error = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=900.0) as resp:
                pushed = 200 <= resp.status < 300
                if not pushed:
                    raise RuntimeError(f"HTTP Push fehlgeschlagen: Status {resp.status}")
            break
        except Exception as e:
            last_error = e
            theUFSession.Ui.SetStatus(f"HTTP Push Versuch {attempt}/3 fehlgeschlagen: {e}")

    if not pushed:
        raise RuntimeError(f"HTTP Push nach 3 Versuchen fehlgeschlagen: {last_error}")

    theUFSession.Ui.SetStatus(f"Export fertig: {len(bom_nodes)} Bauteile übertragen.")

    try:
        theUFSession.Web.OpenUrl("http://htx.local/nx-structure")
    except Exception:
        pass

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        details = traceback.format_exc()
        message = f"HealthTrack-X NX-Export fehlgeschlagen:\n{error}\n\n{details[-1200:]}"
        try:
            NXOpen.UF.UFSession.GetUFSession().Ui.DisplayMessage(message, 1)
        except Exception:
            print(message)
