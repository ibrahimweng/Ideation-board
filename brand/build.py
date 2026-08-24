"""The mark, and every size of it the web asks for.

A disc that breaks into halftone. Halftone is the first effect in the panel and
the one the engine was built to do well, and a dot is already what the app puts
in its corner — so the mark is the product's own signature rather than a shape
chosen to look like a logo.

Two things it has to survive. At sixteen pixels a tab strip gets four hundred
times less of it than an app icon does, so the solid half has to carry the
whole reading and the dots only have to soften one edge. And the composition is
not the circle: the dots have mass too, so the whole thing is measured and
centred rather than the disc being centred and the dots left to trail off one
side.

    python3 brand/build.py        writes public/*.svg and brand/*.svg
"""
import math

VB = 64
R = 18.5            # the solid disc
SPLIT_IN = 1.6      # how far past the middle the solid half reaches
STEP = 5.0          # halftone cell — chunky, so 16px keeps some structure
COLS = 4            # any more and the tail is grey mush when it is small

CX = CY = VB / 2
SPLIT = CX + SPLIT_IN


def dots():
    out = []
    for c in range(COLS):
        x = SPLIT + STEP * (0.45 + c)
        # Every other column staggered, the way a real screen is set.
        stag = STEP / 2 if c % 2 else 0
        n = int((R * 2 + STEP * 2) / STEP) + 2
        for k in range(-n, n + 1):
            y = CY + k * STEP + stag
            d = math.hypot(x - CX, y - CY)
            reach = R + STEP * 0.9
            if d > reach:
                continue
            # Falls off along the ramp, and again towards the disc's edge, so
            # the tail thins in both directions instead of ending in a wall.
            t = c / max(1, COLS - 1)
            cov = (1.0 - t) ** 1.15
            cov *= max(0.0, 1.0 - max(0.0, d - R * 0.72) / (reach - R * 0.72)) ** 0.8
            rr = (STEP * 0.5) * math.sqrt(max(0.0, min(1.0, cov)))
            if rr > 0.42:
                out.append((x, y, rr))
    return out


D = dots()
# The composition, not the circle: measured and then centred.
left = min(CX - R, min(x - r for x, _, r in D))
right = max(CX + R, max(x + r for x, _, r in D))
shift = round(CX - (left + right) / 2, 3)


def mark(fill: str) -> str:
    half = f'<path d="M{SPLIT} {CY - R} A{R} {R} 0 1 0 {SPLIT} {CY + R} Z" fill="{fill}"/>'
    circles = '\n      '.join(
        f'<circle cx="{x + 0:.2f}" cy="{y:.2f}" r="{r:.2f}" fill="{fill}"/>' for x, y, r in D
    )
    return f'<g transform="translate({shift} 0)">\n      {half}\n      {circles}\n    </g>'


ORANGE = '#ff5a1f'
HEAD = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VB} {VB}" width="{VB}" height="{VB}"'


def tile(scale=1.0, radius=14, bg=ORANGE, fg='#fff', label=True):
    inner = mark(fg)
    if scale != 1.0:
        off = VB * (1 - scale) / 2
        inner = f'<g transform="translate({off:.2f} {off:.2f}) scale({scale})">{inner}</g>'
    title = '\n  <title>Ideation Board</title>' if label else ''
    role = ' role="img" aria-label="Ideation Board"' if label else ''
    rect = f'<rect width="{VB}" height="{VB}" rx="{radius}" fill="{bg}"/>'
    return f'{HEAD}{role}>{title}\n  {rect}\n  {inner}\n</svg>\n'


if __name__ == '__main__':
    open('public/favicon.svg', 'w').write(tile())
    # Android and iOS crop a maskable icon to whatever shape they like, so the
    # mark stands well inside the safe circle and the tile has no corners.
    open('brand/maskable.svg', 'w').write(tile(scale=0.72, radius=0))
    # iOS puts its own mask on a touch icon and composites what is under the
    # corners onto black, so this one is square and full bleed.
    open('brand/apple.svg', 'w').write(tile(radius=0))
    # No tile: for a README, a document, anywhere with a ground of its own.
    open('brand/mark.svg', 'w').write(
        f'{HEAD} role="img" aria-label="Ideation Board">\n  <title>Ideation Board</title>\n  {mark(ORANGE)}\n</svg>\n'
    )
    print(f'{len(D)} dots, shifted {shift}')
