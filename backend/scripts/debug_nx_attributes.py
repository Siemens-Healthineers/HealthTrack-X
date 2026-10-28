# ==============================================================================
# Siemens NX Open — Diagnose-Skript für Attribute & Massen
# ==============================================================================
# In NX ausführen: Menü -> Werkzeuge -> Journal -> Wiedergabe (Play)
# Gibt alle im NX-Teil vorhandenen Attribute im NX-Listing-Fenster aus.
# ==============================================================================

import NXOpen
import NXOpen.UF

def main():
    theSession = NXOpen.Session.GetSession()
    theUFSession = NXOpen.UF.UFSession.GetUFSession()
    lw = theSession.ListingWindow
    lw.Open()
    lw.WriteLine("=== DIAGNOSE START ===")

    work_part = theSession.Parts.Work
    if not work_part:
        lw.WriteLine("[ERROR] Kein aktives Work Part!")
        return

    lw.WriteLine(f"Work Part: {work_part.Leaf} ({work_part.FullPath})")

    # 1. Attribute des Work Parts
    lw.WriteLine("\n--- Work Part Attribute (GetUserAttributes) ---")
    for a in work_part.GetUserAttributes():
        t = getattr(a, 'Title', 'NO_TITLE')
        c = getattr(a, 'Category', 'NO_CAT')
        try:
            v = a.StringValue
        except:
            try: v = a.RealValue
            except: v = a.IntegerValue
        lw.WriteLine(f"  [{c}] {t} = {v}")

    # 2. Durchsuche alle Komponenten
    root = work_part.ComponentAssembly.RootComponent
    if root:
        lw.WriteLine("\n--- Baugruppen-Komponenten ---")
        for comp in root.GetChildren():
            lw.WriteLine(f"\nKomponente: {comp.DisplayName} (Name: {comp.Name})")

            # Component User Attributes
            lw.WriteLine("  -> Component Occurrence Attribute:")
            for a in comp.GetUserAttributes():
                t = getattr(a, 'Title', 'NO_TITLE')
                c = getattr(a, 'Category', 'NO_CAT')
                try: v = a.StringValue
                except:
                    try: v = a.RealValue
                    except: v = a.IntegerValue
                lw.WriteLine(f"     [{c}] {t} = {v}")

            # Prototype Part
            proto = comp.Prototype
            if proto:
                part_tag = proto.Tag
                try:
                    p_obj = NXOpen.Utilities.NXObjectManager.Get(part_tag)
                    lw.WriteLine(f"  -> Prototype Part: {getattr(p_obj, 'Leaf', 'NO_LEAF')}")
                    for a in p_obj.GetUserAttributes():
                        t = getattr(a, 'Title', 'NO_TITLE')
                        c = getattr(a, 'Category', 'NO_CAT')
                        try: v = a.StringValue
                        except:
                            try: v = a.RealValue
                            except: v = a.IntegerValue
                        lw.WriteLine(f"     [{c}] {t} = {v}")

                    # Bodies im Prototype
                    if hasattr(p_obj, 'Bodies'):
                        lw.WriteLine(f"     Bodies Anzahl: {len(list(p_obj.Bodies))}")
                        for b in p_obj.Bodies:
                            lw.WriteLine(f"     -> Body Tag: {b.Tag}")
                            for ba in b.GetUserAttributes():
                                lw.WriteLine(f"        Body-Attr: [{getattr(ba, 'Category', '')}] {getattr(ba, 'Title', '')} = {getattr(ba, 'StringValue', '')}")
                except Exception as e:
                    lw.WriteLine(f"     [FEHLER bei Prototype]: {e}")

    lw.WriteLine("\n=== DIAGNOSE ENDE ===")

if __name__ == "__main__":
    main()
