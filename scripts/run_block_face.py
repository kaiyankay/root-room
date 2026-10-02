"""
Run the block-face band share for one boulevard site and write the result as JSON.

The JSON is the hand-over to the Rhino generator (08_redefinition §2.10): the measured face in
local metres (frame, property line, block ends, cross streets, trees, utilities), the design
and existing bands, interruption strips, per-tree cells and shares, the selected tree's full
rule-engine envelopes, and the target ghost box. Every value carries its provenance.

Examples
  python3 scripts/run_block_face.py --site KE-198571 --curb 12.0 --depth 0.9 --target Medium --soil native_soil \
      --land-use residential_detached
  python3 scripts/run_block_face.py --site KE-198571 --curb 10.0 --depth 0.9 --target Medium --soil native_soil \
      --existing-width 1.5 --existing-depth 0.6 --existing-soil native_soil
  python3 scripts/run_block_face.py --site KE-198571 --curb 12.0 --depth 0.9 --target Medium --soil native_soil \
      --fixture-main-u 6.8
"""
import argparse
import json
import pathlib
import sys
from datetime import date

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src import block_face as bf  # noqa: E402

OUT_DIR = ROOT / "data" / "processed"


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--site", default="KE-198571")
    p.add_argument("--curb", type=float, default=None, help="curb offset from the street centreline, m (knob)")
    p.add_argument("--depth", type=float, default=None, help="design soil depth, m (knob)")
    p.add_argument("--target", default=None, choices=["Small", "Medium", "Large", "Columnar"], help="Table 9-2 class (knob)")
    p.add_argument("--soil", default=None, choices=["native_soil", "structural_soil", "soil_cell", "other"], help="soil type (knob)")
    p.add_argument("--land-use", default=None, choices=list(bf.LAND_USES),
                   help="Table 8-3 land-use row chosen by the designer (R30); a category, not a numeric knob")
    p.add_argument("--width-level", default=None, choices=list(bf.WIDTH_LEVELS),
                   help="Table 8-3 / 8-4 column for sidewalk and back boulevard (default: minimum)")
    p.add_argument("--knob-provenance", default="DESIGN_ASSUMPTION", choices=["DESIGN_ASSUMPTION", "USER_INPUT"])
    p.add_argument("--curb-provenance", default=None, choices=["DESIGN_ASSUMPTION", "USER_INPUT", "CONFIRMED_SITE_DATA"],
                   help="the curb face is a site fact: CONFIRMED_SITE_DATA with --curb-evidence records a measurement")
    p.add_argument("--curb-evidence", default=None, help="evidence reference for a CONFIRMED_SITE_DATA curb (required then)")
    p.add_argument("--existing-width", type=float, default=None, help="existing open planting strip width, m")
    p.add_argument("--existing-depth", type=float, default=None, help="existing soil depth, m")
    p.add_argument("--existing-soil", default=None, help="existing soil type")
    p.add_argument("--existing-provenance", default="USER_INPUT", choices=["USER_INPUT", "CONFIRMED_SITE_DATA"])
    p.add_argument("--existing-evidence", default=None, help="evidence reference (required for CONFIRMED_SITE_DATA)")
    p.add_argument("--utility-note", default=None)
    p.add_argument("--fixture-main-u", type=float, default=None,
                   help="add a designer-entered water main crossing the band at this u (m east of the tree); USER_INPUT")
    p.add_argument("--no-city-utilities", action="store_true")
    p.add_argument("--extend-property", default=None, metavar="W:SOIL[:PROV[:DEPTH]]",
                   help="R31 zone under the sidewalk toward the property line, e.g. 1.8:structural_soil or 1.8:native_soil:CONFIRMED_SITE_DATA:0.9")
    p.add_argument("--extend-road", default=None, metavar="W:SOIL[:PROV[:DEPTH]]",
                   help="R31 zone under the curb / parking lane toward the centreline, e.g. 2.0:structural_soil")
    p.add_argument("--extension-evidence", default=None, help="evidence reference for a CONFIRMED_SITE_DATA zone")
    p.add_argument("--replacement", action="store_true",
                   help="design as a NEW tree at this position (site_state vacant_replacement, DESIGN_ASSUMPTION): makes structural soil eligible (R08)")
    p.add_argument("--out", default=None, help="output path (default data/processed/block_face_<site>.json)")
    p.add_argument("--sites", default=None, help="SITE records file (default: the King Edward pilot sites; "
                   "scripts/run_site.py writes data/processed/sites_<window>.json for any window)")
    a = p.parse_args(argv)

    sites_path = pathlib.Path(a.sites) if a.sites else bf.si.SITES_PATH
    face = bf.build_block_face(a.site, sites_path)
    existing = {}
    for key, val in (("soil_width_m", a.existing_width), ("soil_depth_m", a.existing_depth), ("soil_type", a.existing_soil)):
        if val is not None:
            existing[key] = {"value": val, "provenance": a.existing_provenance, "evidence": a.existing_evidence}
    if a.utility_note:
        existing["utility_note"] = a.utility_note
    extra = None
    if a.fixture_main_u is not None:
        d_cl = face["tree"]["dist_centreline_m"]
        extra = [{"kind": "water_main", "label": f"designer-entered water main crossing at u = {a.fixture_main_u} m",
                  "provenance": "USER_INPUT",
                  "local_uv": [[a.fixture_main_u, -d_cl], [a.fixture_main_u, face["tree"]["property_line_offset_m"] + 1.0]],
                  "note": "typed by the designer, no evidence; drawn hatched"}]
    extensions = []
    for side, spec in (("property", a.extend_property), ("road", a.extend_road)):
        if spec:
            parts = spec.split(":")
            z = {"side": side, "width_m": float(parts[0]), "soil_type": parts[1] if len(parts) > 1 else None,
                 "provenance": parts[2] if len(parts) > 2 else "DESIGN_ASSUMPTION",
                 "depth_m": float(parts[3]) if len(parts) > 3 else None, "evidence": a.extension_evidence}
            extensions.append(z)
    result = bf.evaluate_block_face(face, a.curb, a.depth, a.target, a.soil, land_use=a.land_use, width_level=a.width_level,
                                    knob_provenance=a.knob_provenance,
                                    existing=existing or None, extra_utilities=extra,
                                    include_city_utilities=not a.no_city_utilities, sites_path=sites_path,
                                    extensions=extensions or None, replacement=a.replacement,
                                    curb_provenance=a.curb_provenance, curb_evidence=a.curb_evidence)
    result["run"] = {"script": "scripts/run_block_face.py", "run_on": date.today().isoformat(), "args": vars(a),
                     "rules": "sources/06_rules.json v" + bf.engine.RULES["version"],
                     "definition": "sources/11_redefinition_2026-09-28.md (supersedes 08); test cases sources/09_block_face_test_cases.md",
                     "sites": str(sites_path.resolve().relative_to(ROOT)) if str(sites_path.resolve()).startswith(str(ROOT)) else str(sites_path)}
    out = pathlib.Path(a.out) if a.out else OUT_DIR / f"block_face_{a.site}.json"
    out.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    s = result["design"]["selected"]["summary"] if result["design"].get("available") else None
    try:
        shown = out.resolve().relative_to(ROOT)
    except ValueError:           # --out outside the project: show the path as given
        shown = out
    print(f"wrote {shown}")
    if s:
        fb = result["design"]["front_boulevard"]["widths_m"]
        print(f"front boulevard (R30, {a.land_use}, {result['knobs']['width_level']['value']}): P/L-curb {fb['property_line_to_curb_face']} "
              f"- sidewalk {fb['sidewalk_clear']} - back {fb['back_boulevard']} - curb {fb['curb']} = {fb['front_boulevard']} m")
        print(f"{a.site}: {s['planting_condition']}, spacing {s['spacing_m']} m, band {s['band_width_m']} m, "
              f"area {s['soil_area_m2']} m2, share {s['share_m3']} m3 [{s['share_status']}] vs {s['required_m3']} m3 "
              f"({a.target} shared_row); solitary {s['solitary_comparison']['required_m3']} m3; "
              f"classes {s['benchmark_classes']}; unresolved {s['unresolved']}; missing {s['missing_inputs']}")
    if s and s.get("extensions"):
        e = s["extensions"]
        for z in e["zones"]:
            print(f"  R31 zone {z['side']}: {z['soil_type']} {z['width_applied_m']} m under {z['under']}: area {z['usable_area_m2']} m2 -> "
                  f"{z['credited_m3']} m3 [{z['status']}] {z['note'][:90]}")
        print(f"  R31 total: band {e['band_share_m3']} + zones {e['extension_share_m3']} = {e['share_total_m3']} m3 [{e['status']}] "
              f"vs {e['required_m3']} -> gap {e['gap_total_m3']}; classes {e['benchmark_classes_total']}")
    ex = result["existing"]
    print(f"existing: {ex['grade']}; " + (f"share {ex['selected']['summary']['share_m3']} m3" if ex.get("available")
                                          else f"UNKNOWN, missing {ex['missing']}"))


if __name__ == "__main__":
    sys.exit(main())
