"""Build packages/vscode/media/xsom-icons.ttf from the xSOM mark.

The mark (frontend/public/xsom-mark.svg) is three stroked arrows, each cut where
the next one crosses it. A font glyph must be plain filled outlines, so the
strokes are outlined and the cuts applied with boolean path operations.

VS Code only spins a few built-in codicons (`~spin` does nothing on contributed
icons), so the font carries the mark at successive angles and the extension
cycles through them. The mark repeats every 120 degrees: FRAMES glyphs cover
one third of a turn, scaled so every angle fits inside the em square.

Requires: fonttools, skia-pathops (build time only, not shipped).
Usage:    python scripts/build-icon-font.py
"""

import math
from pathlib import Path

import pathops
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "packages" / "vscode" / "media" / "xsom-icons.ttf"

# Geometry copied from xsom-mark.svg (viewBox 74.98 34.18 374.18 374.18).
VIEW_SIZE = 374.18
ARROWS = [
    (
        [(189.39, 295.00), (365.12, 295.00), (265.88, 123.11)],
        [(291.86, 108.11), (241.88, 81.54), (239.89, 138.11)],
    ),
    (
        [(255.53, 178.81), (167.67, 331.00), (366.15, 331.00)],
        [(366.15, 361.00), (414.15, 331.00), (366.15, 301.00)],
    ),
    (
        [(323.08, 294.19), (235.22, 142.00), (135.97, 313.89)],
        [(109.99, 298.89), (111.97, 355.46), (161.95, 328.89)],
    ),
]
# Arrow i is masked by arrow MASKED_BY[i] (as in the SVG masks m0, m1, m2).
MASKED_BY = [1, 2, 0]
STROKE, CUT_STROKE, HEAD_CUT_STROKE = 28, 44, 16

UNITS_PER_EM = 1000
FIRST_CODEPOINT = 0xE000
FRAMES = 6


def polyline(points: list[tuple[float, float]]) -> pathops.Path:
    path = pathops.Path()
    path.moveTo(*points[0])
    for point in points[1:]:
        path.lineTo(*point)
    return path


def polygon(points: list[tuple[float, float]]) -> pathops.Path:
    path = polyline(points)
    path.close()
    return path


def stroked(path: pathops.Path, width: float) -> pathops.Path:
    outline = pathops.Path()
    outline.addPath(path)
    outline.stroke(width, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, 4)
    return outline


def arrow(line: list[tuple[float, float]], head: list[tuple[float, float]]) -> pathops.Path:
    return pathops.op(stroked(polyline(line), STROKE), polygon(head), pathops.PathOp.UNION)


def cut(line: list[tuple[float, float]], head: list[tuple[float, float]]) -> pathops.Path:
    return pathops.op(
        stroked(polyline(line), CUT_STROKE),
        stroked(polygon(head), HEAD_CUT_STROKE),
        pathops.PathOp.UNION,
    )


def mark() -> pathops.Path:
    result = pathops.Path()
    for index, (line, head) in enumerate(ARROWS):
        mask_line, mask_head = ARROWS[MASKED_BY[index]]
        piece = pathops.op(arrow(line, head), cut(mask_line, mask_head), pathops.PathOp.DIFFERENCE)
        result = pathops.op(result, piece, pathops.PathOp.UNION)
    return result


class FontUnitsPen:
    """Maps SVG coordinates (y down) to font units (y up), turned about the mark's centre."""

    def __init__(self, pen: TTGlyphPen, degrees: float, scale: float) -> None:
        self.pen = pen
        self.cos = math.cos(math.radians(degrees)) * scale
        self.sin = math.sin(math.radians(degrees)) * scale

    def _map(self, point: tuple[float, float]) -> tuple[int, int]:
        half = UNITS_PER_EM / 2
        x, y = unit_offset(point)
        return (
            round(half + x * self.cos - y * self.sin),
            round(half + x * self.sin + y * self.cos),
        )

    def moveTo(self, point):
        self.pen.moveTo(self._map(point))

    def lineTo(self, point):
        self.pen.lineTo(self._map(point))

    def qCurveTo(self, *points):
        self.pen.qCurveTo(*[self._map(point) for point in points])

    def curveTo(self, *points):
        raise ValueError("cubic curves are not expected in the mark outline")

    def closePath(self):
        self.pen.closePath()

    def endPath(self):
        self.pen.endPath()


# The three arrows are copies of one another turned by 120 degrees, so the mean
# of their corner points is the centre the mark turns about.
CENTRE = (
    sum(x for line, _ in ARROWS for x, _ in line) / 9,
    sum(y for line, _ in ARROWS for _, y in line) / 9,
)


def unit_offset(point: tuple[float, float]) -> tuple[float, float]:
    """SVG point to font units relative to the mark's centre (y up)."""
    scale = UNITS_PER_EM / VIEW_SIZE
    return (
        (point[0] - CENTRE[0]) * scale,
        (CENTRE[1] - point[1]) * scale,
    )


def fitting_scale(outline: pathops.Path) -> float:
    """Largest scale keeping every rotated point inside the em square."""
    radius = max(math.hypot(*unit_offset(point)) for point in outline.points)
    return min(1.0, (UNITS_PER_EM / 2) / radius)


def main() -> None:
    outline = mark()
    outline.simplify()
    scale = fitting_scale(outline)
    names = [f"xsom-mark-{index}" for index in range(FRAMES)]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    for index, name in enumerate(names):
        pen = TTGlyphPen(None)
        # Counter-clockwise, the way the arrows point (positive angle, y up).
        outline.draw(FontUnitsPen(pen, 120 * index / FRAMES, scale))
        glyphs[name] = pen.glyph()

    builder = FontBuilder(UNITS_PER_EM, isTTF=True)
    builder.setupGlyphOrder([".notdef", *names])
    builder.setupCharacterMap({FIRST_CODEPOINT + index: name for index, name in enumerate(names)})
    builder.setupGlyf(glyphs)
    glyf = builder.font["glyf"]
    # The left side bearing must equal each glyph's xMin, or renderers shift it.
    for glyph in glyphs.values():
        glyph.recalcBounds(glyf)
    builder.setupHorizontalMetrics(
        {name: (UNITS_PER_EM, getattr(glyph, "xMin", 0)) for name, glyph in glyphs.items()}
    )
    builder.setupHorizontalHeader(ascent=UNITS_PER_EM, descent=0)
    builder.setupNameTable({"familyName": "xsom-icons", "styleName": "Regular"})
    builder.setupOS2(
        sTypoAscender=UNITS_PER_EM,
        sTypoDescender=0,
        usWinAscent=UNITS_PER_EM,
        usWinDescent=0,
    )
    builder.setupPost()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    builder.save(OUTPUT)
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
