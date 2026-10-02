"""
Pure numeric operations used by the rule engine.

No source constants live here. Factors, thresholds and lookup tables are passed
in by rule_engine from sources/06_rules.json. Every function returns None when a
required numeric input is None so that UNKNOWN propagates instead of defaulting.
"""
from typing import Any, Dict, List, Optional, Sequence

Number = Optional[float]


def lookup(table: Dict[str, Any], *keys: str) -> Any:
    """Nested dictionary lookup. Returns None if any key is missing or None."""
    node: Any = table
    for key in keys:
        if key is None or not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def multiply(a: Number, b: Number) -> Number:
    if a is None or b is None:
        return None
    return a * b


def multiply_by_factor(value: Number, factor: Number) -> Number:
    if value is None or factor is None:
        return None
    return value * factor


def copy_value(value: Number) -> Number:
    return value


def subtract(a: Number, b: Number) -> Number:
    if a is None or b is None:
        return None
    return a - b


def classes_meeting_threshold(credited: Number, thresholds: Dict[str, float]) -> Optional[List[str]]:
    """Classes whose threshold is <= credited volume, in the order given by `thresholds`."""
    if credited is None:
        return None
    return [cls for cls, threshold in thresholds.items() if credited >= threshold]


def _ring_area(ring: Sequence[Sequence[float]]) -> float:
    """Shoelace area of a closed or open planar ring, in the ring's coordinate units squared."""
    n = len(ring)
    if n < 3:
        return 0.0
    s = 0.0
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def planar_polygon_area(geometry: Dict[str, Any]) -> Number:
    """
    Planar area of a GeoJSON Polygon or MultiPolygon: outer ring minus holes.

    The result is in squared coordinate units. The caller is responsible for
    knowing that the coordinates are metric; this function makes no CRS assumption.
    Returns None for non-areal geometry types.
    """
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "Polygon":
        polygons = [coords]
    elif gtype == "MultiPolygon":
        polygons = coords
    else:
        return None
    total = 0.0
    for rings in polygons:
        if not rings:
            continue
        total += _ring_area(rings[0])
        for hole in rings[1:]:
            total -= _ring_area(hole)
    return total


def values_close(a: Number, b: Number, tol: float = 1e-9) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= tol
