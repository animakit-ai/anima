#!/usr/bin/env python3
"""Render regulation.csv → regulation.png in the animakit VISUAL_IDENTITY palette.

The CSV is produced by `pnpm bench:regulation` (the REAL engine). This script only
draws it — every number on the chart comes from that run, never from here.

    pip install matplotlib    # only dependency
    python benchmarks/plot.py
"""
import csv
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

# ── VISUAL_IDENTITY palette ───────────────────────────────────────────────────
BG, SURF, GRID = "#0D1117", "#161B22", "#30363D"
TXT, SEC, FAINT = "#C9D1D9", "#8B949E", "#484F58"
TEAL, AMBER = "#2DD4BF", "#F0883E"  # teal = correct/recovery · amber = error/panic

PANIC, FLOW = 0.80, 0.30

# ── Load the real run ─────────────────────────────────────────────────────────
rows = list(csv.DictReader(open(Path(__file__).with_name("regulation.csv"))))
x = list(range(len(rows)))
stress = [float(r["stress"]) for r in rows]
trivial = [float(r["accept_trivial"]) * 100 for r in rows]
important = [float(r["accept_important"]) * 100 for r in rows]
phase = [r["phase"] for r in rows]

def span(name):
    idx = [i for i, p in enumerate(phase) if p == name]
    return (min(idx), max(idx)) if idx else None

flood, recovery = span("flood"), span("recovery")
first_panic = next((i for i, s in enumerate(stress) if s >= PANIC), None)

# ── Fonts (fall back silently if not installed) ───────────────────────────────
plt.rcParams["font.family"] = "monospace"
plt.rcParams["font.monospace"] = ["JetBrains Mono", "DejaVu Sans Mono"] + plt.rcParams["font.monospace"]
plt.rcParams.update({"text.color": TXT, "axes.edgecolor": GRID,
                     "xtick.color": SEC, "ytick.color": SEC})

fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.2, 9.0), dpi=150,
                               gridspec_kw={"height_ratios": [3, 2]})
fig.subplots_adjust(left=0.13, right=0.94, top=0.83, bottom=0.13, hspace=0.34)
fig.patch.set_facecolor(BG)

# top teal accent bar (constant brand signature)
fig.add_artist(Rectangle((0, 0.985), 1, 0.015, color=TEAL, transform=fig.transFigure, zorder=5))

# kicker + headline
fig.text(0.12, 0.945, "A N I M A K I T   ·   @animakit/homeostasis", color=TEAL, fontsize=11)
fig.text(0.12, 0.905, "I overloaded my agent on purpose.", color=TXT, fontsize=22, fontweight="bold")
fig.text(0.12, 0.875, "Safety valve fired, then self-recovered — no rate limit.", color=SEC, fontsize=11)

# ── Panel 1 — stress trajectory ───────────────────────────────────────────────
for a in (ax1, ax2):
    a.set_facecolor(BG)
    for s in a.spines.values():
        s.set_color(GRID)
    a.grid(True, color=GRID, linewidth=0.5, alpha=0.5)

ax1.axhspan(PANIC, 1.02, color=AMBER, alpha=0.12)         # panic band
ax1.axhline(PANIC, color=AMBER, ls="--", lw=1, alpha=0.8)
ax1.axhline(FLOW, color=FAINT, ls="--", lw=1, alpha=0.8)
ax1.plot(x, stress, color=TEAL, lw=2.2)
# amber dots where in panic
px = [i for i, s in enumerate(stress) if s >= PANIC]
ax1.scatter(px, [stress[i] for i in px], color=AMBER, s=18, zorder=4)

ax1.text(len(x) * 0.985, PANIC + 0.015, "panic 0.80", color=AMBER, fontsize=9, ha="right")
ax1.text(len(x) * 0.985, FLOW + 0.015, "flow 0.30", color=SEC, fontsize=9, ha="right")
if first_panic is not None:
    ax1.annotate("panic at the 8th hit", xy=(first_panic, stress[first_panic]),
                 xytext=(first_panic + 4, 0.30), color=AMBER, fontsize=10,
                 arrowprops=dict(arrowstyle="->", color=AMBER))
if recovery:
    ax1.annotate("recovers itself — decay only,\nno rate limit", xy=(int(len(x) * 0.8), stress[int(len(x) * 0.8)]),
                 xytext=(38, 0.62), color=TEAL, fontsize=10,
                 arrowprops=dict(arrowstyle="->", color=TEAL))
ax1.set_ylim(0, 1.02); ax1.set_xlim(0, len(x) - 1)
ax1.set_ylabel("stress", color=TXT, fontsize=11)

# phase labels
if flood:
    ax1.text((flood[0] + flood[1]) / 2, 1.06, "FLOOD", color=AMBER, fontsize=9, ha="center")
if recovery:
    ax1.text((recovery[0] + recovery[1]) / 2, 1.06, "RECOVERY", color=TEAL, fontsize=9, ha="center")

# ── Panel 2 — task acceptance (the shedding) ──────────────────────────────────
ax2.plot(x, important, color=TEAL, lw=2.2, label="important task (priority 0.9)")
ax2.plot(x, trivial, color=AMBER, lw=2.2, label="trivial task (priority 0.3)")
ax2.set_ylim(-3, 108); ax2.set_xlim(0, len(x) - 1)
ax2.set_ylabel("% accepted", color=TXT, fontsize=11)
ax2.set_xlabel("event  ·  flood (failures) → recovery (decay ticks)", color=SEC, fontsize=10)
ax2.legend(facecolor=SURF, edgecolor=GRID, labelcolor=TXT, fontsize=9, loc="lower right")
# annotate the divergence at peak
if flood:
    ax2.annotate("trivial work shed (4%),\nimportant protected (11%)", xy=(flood[1], trivial[flood[1]]),
                 xytext=(24, 50), color=TXT, fontsize=9, ha="left",
                 arrowprops=dict(arrowstyle="->", color=SEC))

# footer lockup
fig.text(0.13, 0.035, "benchmarks/regulation.ts · reproducible", color=SEC, fontsize=9)
fig.text(0.94, 0.035, "— Justine", color=SEC, fontsize=9, ha="right", style="italic")
fig.add_artist(Rectangle((0.13, 0.055), 0.81, 0.0015, color=GRID, transform=fig.transFigure))

out = Path(__file__).with_name("regulation.png")
fig.savefig(out, facecolor=BG)
print(f"wrote {out}  ({len(rows)} points)")
