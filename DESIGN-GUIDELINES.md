# Design guidelines

Derived from Material Design 3 (m3.material.io, design-system rev 38.0.1, read
2026-08-10), then adapted for a text-dense catalogue website rather than an
Android app. Where we deviate from M3, the deviation is stated and justified.

M3 was restructured in May 2026: "window size class" is now **breakpoint**,
"responsive" is now **adaptive**, spacing became its own top-level style
section, and surface tint was deprecated. The numbers below are from the current
site, not the older M3 that most articles describe.

---

## 1. Spacing

Base unit **8px**. M3's published token set, which is an 8-multiplier scale with
"nested units" at the half-steps that components actually need:

| Token | px | | Token | px |
|---|---|---|---|---|
| `--sp-0` | 0 | | `--sp-300` | 24 |
| `--sp-25` | 2 | | `--sp-400` | 32 |
| `--sp-50` | 4 | | `--sp-450` | 36 |
| `--sp-75` | 6 | | `--sp-500` | 40 |
| `--sp-100` | **8** | | `--sp-600` | 48 |
| `--sp-125` | 10 | | `--sp-700` | 56 |
| `--sp-150` | 12 | | `--sp-800` | 64 |
| `--sp-175` | 14 | | `--sp-900` | 72 |
| `--sp-200` | 16 | | | |
| `--sp-250` | 20 | | | |

Rules:

1. **Never use a value outside this scale.** The old stylesheet mixed 3.5, 5,
   10, 14 and 18px paddings; that is what made the spacing read as accidental.
2. **Padding and gap before margin.** M3: *"Material rarely uses margins in
   components."* Define spacing on the parent (padding, `gap`), not as margins
   on children. This is the single biggest structural fix.
3. Spacing must **not** shrink when text is scaled to 200%.

Applied to this site (M3 leaves this mapping to the product; these are ours):

| Where | Value |
|---|---|
| Inside a card | **16** |
| Between cards in a grid | **8** |
| Heading → its own content | **12** |
| Between sections on a page | **40** |
| Page head band → body | **32** |
| Body → footer | **64** |
| Inside a chip / pill | 8 vertical, 12–16 horizontal |
| Between two inline controls | 8 |

---

## 2. Breakpoints and layout

M3's five breakpoints, with M3's own margin values:

| Breakpoint | Width | Page margin | Panes | Navigation |
|---|---|---|---|---|
| Compact | < 600 | **16** | 1 | Bottom bar, or modal drawer |
| Medium | 600–839 | **24** | 1 (or 2) | Bar, or modal expanded rail |
| Expanded | 840–1199 | **24** | 2 recommended | Expanded rail |
| Large | 1200–1599 | **24** | 2 | Expanded rail |
| Extra-large | ≥ 1600 | **24** | 2–3 | Expanded rail |

**Deviation:** M3 prescribes a navigation bar/rail because it specs
applications. This is a website with a wordmark, eight destinations and two
menus, so we keep a **top app bar** at every size and drop to a sheet below
`expanded`. M3's top app bar spec still governs its height and colour.

Pane spacer between two panes: **24**.

**Line length: 40–60 characters.** This is M3's only readability width and it is
the rule the old design broke worst — a 896px prose column at 15px ran to ~110
characters. Reading columns are set in `ch`, not px.

M3 no longer publishes column counts or gutter values; the old 12-column grid is
M2 and deprecated. We use CSS grid with `auto-fit` and a min track width instead
of a fixed column count, which is the modern equivalent and needs no table.

---

## 3. Type scale

M3's 15 roles, verbatim (size / line-height / tracking / weight):

| Role | Size | Line height | Tracking | Weight |
|---|---|---|---|---|
| display-large | 57 | 64 | −0.25 | 400 |
| display-medium | 45 | 52 | 0 | 400 |
| display-small | 36 | 44 | 0 | 400 |
| headline-large | 32 | 40 | 0 | 400 |
| headline-medium | 28 | 36 | 0 | 400 |
| headline-small | 24 | 32 | 0 | 400 |
| title-large | 22 | 28 | 0 | 400 |
| title-medium | 16 | 24 | 0.15 | 500 |
| title-small | 14 | 20 | 0.1 | 500 |
| body-large | 16 | 24 | 0.5 | 400 |
| body-medium | 14 | 20 | 0.25 | 400 |
| body-small | 12 | 16 | 0.4 | 400 |
| label-large | 14 | 20 | 0.1 | 500 |
| label-medium | 12 | 16 | 0.5 | 500 |
| label-small | 11 | 16 | 0.5 | 500 |

Assignments for this site:

| Element | Role |
|---|---|
| Hero headline | display-small → display-large, fluid |
| Page `<h1>` | headline-large |
| Section `<h2>` | title-large |
| Card title | title-medium |
| Reading paragraph | **body-large** |
| Secondary / meta text | body-medium |
| Captions, receipts | body-small |
| Button, chip, nav label | label-large |
| Eyebrow, table header | label-small, uppercased |

**Deviations:**
- Body text moves from 15px to **16px** (body-large). 15 is not on the scale and
  16 is M3's reading size.
- We keep Space Grotesk for display/headline/title and IBM Plex Sans for
  body/label — M3's brand/plain typeface split, with our own faces.
- We keep tabular figures on every compared number. M3 asks for this explicitly.
- The mono eyebrow is ours, not M3's. It is label-small with our mono face; it
  survives because it is doing a real job (marking machine-checked facts).

---

## 4. Elevation and depth

**This is the biggest change, and the one that fixes the "flat but noisy" feel.**

M3's elevation tokens carry **only a dp distance — no shadow**. Depth comes
first from the **surface-container tonal ramp**, and shadow is opt-in:

> *"Instead of applying shadows by default to all levels, use shadows only when
> required to create additional protection against a background or to encourage
> interaction."*

Levels, and the shadow spec if one is warranted (this two-part spec is the
`material-web` reference implementation — the site itself publishes no shadow):

| Level | dp | Key shadow (30%) | Ambient shadow (15%) | Resting components |
|---|---|---|---|---|
| 0 | 0 | — | — | Cards, chips, buttons, lists, tabs, app bar unscrolled |
| 1 | 1 | `0 1px 2px 0` | `0 1px 3px 1px` | Elevated card/button/chip, banner |
| 2 | 3 | `0 1px 2px 0` | `0 2px 6px 2px` | **App bar scrolled**, menu, nav bar |
| 3 | 6 | `0 1px 3px 0` | `0 4px 8px 3px` | Dialog, search, pickers, FAB |
| 4 | 8 | `0 2px 3px 0` | `0 6px 10px 4px` | *interaction only* |
| 5 | 12 | `0 4px 4px 0` | `0 8px 12px 6px` | *interaction only* |

Rules:

1. **Resting elevation is 0–3 only. Levels 4 and 5 are interaction states.**
2. Hover raises a component by **exactly one level**.
3. **Surface tint is deprecated.** Any "primary at N% overlay" is M2-era. Delete.
4. Use as few distinct levels as possible — *"the fewer levels in your UI, the
   more power they have."*
5. **Our catalogue cards sit at level 0** with a 1px `outline-variant` border, on
   `surface`. That is M3's **outlined card**, and per M3 the outlined variant
   carries the *greatest* emphasis of the three — ahead of elevated. The old
   design gave every card a resting shadow, which is exactly what M3 stopped
   doing.
6. Scrim: the `scrim` role at **32%** opacity.

M3's own warning, worth heeding on a catalogue: *"Don't force content into cards
when spacing, headlines, or dividers would create a simpler visual hierarchy."*

---

## 5. Colour — the surface ramp

M3 builds depth from **tone**, not light. Tone is CIE L\*, so the ramp is an
equal-lightness ladder on a near-neutral palette derived from the brand hue.

| Role | Light tone | Dark tone | Use |
|---|---|---|---|
| `surface` | N-98 | N-6 | Page background |
| `surface-container-lowest` | N-100 | N-4 | Lowest-emphasis container |
| `surface-container-low` | N-96 | N-10 | Elevated card, banner |
| `surface-container` | N-94 | N-12 | **Default container**, nav, menus |
| `surface-container-high` | N-92 | N-17 | Dialog, search |
| `surface-container-highest` | N-90 | N-22 | Filled card, filled field |
| `surface-dim` / `-bright` | N-87 / N-98 | N-6 / N-24 | Keep relative brightness in both themes |
| `on-surface` | N-10 | N-90 | Text |
| `on-surface-variant` | NV-30 | NV-80 | Secondary text |
| `outline` | NV-50 | NV-60 | Boundaries that define a target |
| `outline-variant` | NV-80 | NV-30 | Dividers, card borders |

The mechanism, in one rule:

> *"Any overlapping containment areas or components should have different color
> roles in order to visually communicate separation."*

Note the step sizes are **not symmetric**: light steps 2 tones at a time
(100→96→94→92→90), dark steps 4→10→12→17→22, because perceptual separation at
low luminance needs more tonal distance. Do not "simplify" the dark ramp to even
steps — it will collapse.

Also: `outline` for boundaries that define a target (a text field); never for
dividers. `outline-variant` for dividers and card borders; never to define a
target boundary.

### Our brand colours

The palette is generated at fixed L\* on the brand's own hue (h = 289.8,
computed from `#2f6fed`), so our greys are quietly related to the blue rather
than dead neutral.

**Deviations, both deliberate:**

1. **`--brand` stays exactly `#2f6fed`** (light) and `#4c8dff` (dark). M3 would
   put primary at tone 40 (`#0058c9`) and dark primary at tone 80 (`#bdc2fe`);
   both are visibly different colours and the brand is not up for redesign.
   `#4c8dff` measures 5.79:1 on the dark surface, so it passes on its own merit.
2. **`--brand-text: #0e64e0`** exists because `#2f6fed` measures **4.34:1** on
   the light surface — it fails AA for body-size text, though it passes 3:1 for
   UI and large text, and passes 4.55:1 as a white-on-blue button. So the brand
   hex is kept for every **fill, mark and large-text** use, and links at body
   size use the tone-45 sibling. This is a real accessibility bug in the current
   site, not a stylistic preference.

Every shipped pair is contrast-audited by `design/palette.mjs` (`bun
design/palette.mjs`), which regenerates the whole ramp from the brand hex and
prints a pass/fail table. All pairs pass at their required ratio.

---

## 6. State layers

M3 models interaction as a translucent overlay **between the container and the
content**, coloured with the *content* colour, not the container's.

| State | Opacity |
|---|---|
| Hover | **8%** |
| Focus | **10%** |
| Pressed | **10%** |
| Dragged | 16% |
| Disabled content | 38% |

Rules: one state layer at a time; the layer is 40px where the target is 48px;
disabled components take no state layer.

---

## 7. Shape

M3's corner scale, expanded to 10 steps in the expressive update:

| Style | px | Components |
|---|---|---|
| None | 0 | App bars, nav bar, tabs |
| Extra small | 4 | Menu, snackbar, tooltip, **text fields** |
| Small | 8 | **Chips** |
| Medium | 12 | **Cards** |
| Large | 16 | FAB, navigation drawer |
| Large increased | 20 | *(new)* |
| Extra large | 28 | Dialogs, sheets |
| Extra large increased | 32 | *(new)* |
| Extra extra large | 48 | *(new)* |
| Full | pill | **All buttons**, search bar |

Nesting rule: **inner radius = outer radius − padding**. Never give a nested
container the same radius as its parent.

**Correction to the previous pass:** filter chips were pill-shaped. M3 gives
chips an **8px** radius and reserves `full` for buttons — that distinction is
what stops a filter reading as an action.

---

## 8. Motion

The easing/duration system is deprecated upstream in favour of springs, but it
is what the web can express, and M3 still publishes it for transitions.

| Easing | CSS |
|---|---|
| Standard | `cubic-bezier(0.2, 0, 0, 1)` |
| Standard decelerate | `cubic-bezier(0, 0, 0, 1)` |
| Standard accelerate | `cubic-bezier(0.3, 0, 1, 1)` |
| Emphasized decelerate | `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| Emphasized accelerate | `cubic-bezier(0.3, 0, 0.8, 0.15)` |

`easing.emphasized` **cannot be expressed as a single cubic-bezier** — M3 says to
use Standard as the web fallback.

Durations: short 50/100/150/200 · medium 250/300/350/400 · long 450–600 ·
extra-long 700–1000.

| Transition | Easing | Duration |
|---|---|---|
| Begins and ends on screen | Standard | 300 |
| Enters | Standard decelerate | 250 |
| Exits | Standard accelerate | 200 |
| Small utility (hover, colour) | Standard | **150** |

Exit is always shorter than enter. Duration scales with distance travelled.

---

## 9. Components

From M3's specs, adapted to the web:

| Component | Height | Radius | Padding | Container |
|---|---|---|---|---|
| Top app bar (small) | **64** | 0 | 16/24 margin | `surface`; scrolled → `surface-container` + level 2 |
| Card | — | 12 | **16** | outlined: `surface` + 1px `outline-variant` |
| Button (M3 small) | **40** | full | 16 | filled: `brand`/`on-brand` |
| Chip | **32** | **8** | 16, or 8 with icon | unselected: transparent + `outline-variant`<br>selected: `brand-container` + **outline removed** |
| Text field (outlined) | **56** | 4 | 16 | transparent, 1px `outline`, 2px focused |
| List item, 1 line | 56 | — | 16 left / 24 right | — |
| Divider | 1px | — | inset 16 left | `outline-variant` |

Selected-chip detail worth calling out: **the outline goes to 0 when selected**.
Most implementations keep it and the selected state reads as muddy.

Button hierarchy, in M3's usage order: **filled** (one per page, the
flow-completing action) → **tonal** → **outlined** (secondary, pairs with
filled) → **text** (lowest). "Elevated" is *"only when absolutely necessary"* —
when a button must separate from a busy background.

---

## 10. Accessibility

| Rule | Value |
|---|---|
| Touch target | **48 × 48** minimum |
| Pointer target | 44 × 44 |
| Spacing between targets | **8** minimum |
| Small text contrast | **4.5:1** |
| Large text (≥18.66px bold / 24px) and UI | **3:1** |
| Disabled states | exempt from contrast |

A 24px icon still gets a 48px target — the target extends past the visual bounds.

Clustered controls (a row of filter chips) each need 3:1 container-vs-background,
because the user has to separate them from one another. A standalone prominent
element does not.
