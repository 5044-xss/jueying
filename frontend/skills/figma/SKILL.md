---
name: figma
description: "Figma marketing design system reference: colors, typography, layout, components, and responsive behavior for Figma's monochrome + pastel color-block brand language"
---

## Overview

Figma's marketing canvas is a confident black-and-white editorial frame interrupted by oversized, hand-cut pastel color blocks. The chrome — top nav, body type, footer, primary CTA — is monochrome. What makes the design unique is the page repeatedly dropping into oversized pastel **color-block sections** (lime, lavender, cream, mint, pink, coral, navy) that span full content width.

### Key Characteristics
- Monochrome system core: black primary and white canvas carry every CTA, body line, footer link
- Oversized pastel **color-block sections** define the narrative rhythm of every long-form page
- Pill is the only button shape — no square buttons
- `figmaSans` variable typeface at unusually fine weight increments (320, 330, 340, 450, 480, 540)
- Tight negative letter-spacing on display sizes (-1.72px at 86px)
- `figmaMono` reserved for eyebrows and captions (uppercase, positive tracking)
- Page rhythm: white canvas → color block → white canvas → color block (each block separated by white space)

## Colors

### Brand & Surface
- **primary** (#000000): All primary CTAs, headlines, body lines
- **canvas** (#ffffff): Default page background, white cards
- **inverse-canvas** (#000000): Footer, marquee strip
- **surface-soft** (#f7f7f5): Off-white tiles for icon buttons, template cards

### Color Blocks (pastel palette)
- **block-lime** (#dceeb1): Systems/FAQ/contact form sections
- **block-lilac** (#c5b0f4): /design/ hero, promo banners
- **block-cream** (#f4ecd6): FigJam hero, template grids
- **block-mint** (#c8e6cd): FigJam pastel sections
- **block-pink** (#efd4d4): FigJam pastel sections
- **block-coral** (#f3c9b6): Ship products story block
- **block-navy** (#1f1d3d): Deep indigo story block (only dark surface above footer)

### Text
- **ink** (#000000): All text on light surfaces (no mid-gray — hierarchy from weight, not opacity)
- **inverse-ink** (#ffffff): Text on dark surfaces
- **accent-magenta** (#ff3d8b): Single promo CTA color (use sparingly, one per page)

### Semantic
- **semantic-success** (#1ea64a): Pricing comparison checkmarks
- **overlay-scrim** (#000000): Modal/video overlay background

## Typography

### Font Family
- **figmaSans** — Variable typeface; fallback `figmaSans Fallback, SF Pro Display, system-ui, helvetica`
- **figmaMono** — Monospace for eyebrows/captions only; fallback `figmaMono Fallback, SF Mono, menlo`

### Type Scale

| Token | Size | Weight | Line Ht | Letter Spacing | Use |
|---|---|---|---|---|---|
| display-xl | 86px | 340 | 1.00 | -1.72px | Hero headlines |
| display-lg | 64px | 340 | 1.10 | -0.96px | Section openers |
| headline | 26px | 540 | 1.35 | -0.26px | Story-block titles |
| subhead | 26px | 340 | 1.35 | -0.26px | Long-form intro |
| card-title | 24px | 700 | 1.45 | 0 | Pricing/feature card titles |
| body-lg | 20px | 330 | 1.40 | -0.14px | Lead body, form labels |
| body | 18px | 320 | 1.45 | -0.26px | Default body |
| body-sm | 16px | 330 | 1.45 | -0.14px | Card body, footer links |
| link | 20px | 480 | 1.40 | -0.10px | Inline links |
| button | 20px | 480 | 1.40 | -0.10px | All pill buttons |
| eyebrow | 18px | 400 | 1.30 | 0.54px | figmaMono section labels |
| caption | 12px | 400 | 1.00 | 0.60px | figmaMono captions |

### Principles
- Weight (not size) carries hierarchy on body copy
- Negative letter-spacing scales with display size
- Mono is taxonomy, not body — never used for paragraphs
- Tight line-heights on display, generous on body

### Font Substitutes (if no figmaSans/Mono)
- Sans: Inter or Geist
- Mono: JetBrains Mono or Geist Mono

## Layout

### Spacing System (base unit: 8px)
- hair: 1px · xxs: 4px · xs: 8px · sm: 12px · md: 16px · lg: 24px · xl: 32px · xxl: 48px · section: 96px

### Grid
- Max content width: ~1280px
- Color-block sections break the column grid — full bleed inside rounded.lg corners
- White space between color blocks = 96px (section rhythm constant)

## Shapes (Border Radius)

| Token | Value | Use |
|---|---|---|
| xs | 2px | Link decoration |
| sm | 6px | Small chips, tabs |
| md | 8px | Form inputs, images |
| lg | 24px | Pricing cards, color blocks |
| xl | 32px | Hero panels |
| pill | 50px | All text CTAs |
| full | 9999px | Circular icon buttons |

## Components

### Buttons
- **button-primary**: Black pill (#000000 bg, white text, 10px 20px)
- **button-secondary**: White pill (white bg, black text, 8px 18px 10px, no border)
- **button-tertiary-text**: Plain text link hit target
- **button-icon-circular**: 40px circle (#f7f7f5 bg)
- **button-icon-circular-inverse**: 40px circle on dark surfaces
- **button-magenta-promo**: Saturated pink pill (one per page max)

### Navigation
- **top-nav**: 56px sticky white bar, logo + links + two right-anchored pills
- **marquee-strip**: 36px black ribbon with scrolling customer logos

### Color-Block Sections (signature)
Full-content-width panels with rounded.lg, 48px interior padding. One color per section. Never combine two color blocks in one viewport.

### Cards
- **pricing-card**: White card, rounded.lg, hairline border, 24px padding
- **template-card**: #f7f7f5 tile, rounded.md, 16px padding
- **feature-illustration-tile**: #f7f7f5 tile for UI mock compositions

### Pricing
- **pricing-tab-default**: White pill
- **pricing-tab-selected**: Black pill (same as button-primary surface)

## Elevation
- Level 0: Flat (default — color blocks are the depth device)
- Level 1: 1px hairline border
- Level 2: Subtle shadow for floating elements
- Level 3: Stronger shadow + overlay scrim for modals

No drop shadows on color-block sections — color substitutes for elevation.

## Responsive

### Breakpoints
| Name | Width | Changes |
|---|---|---|
| 4k | 1920px | Max 1280px, gutters expand |
| Desktop | 1400px | Default layout |
| Tablet | 960px | Pricing 4→2-up, hamburger nav |
| Mobile-L | 768px | Color blocks go full-bleed |
| Mobile | 560px | display-xl→~48px, CTAs full-width |

## Do's and Don'ts

### Do
- Reserve primary black for genuine CTAs and selected states
- Choose **one** color block per story section
- Keep figmaSans at documented weights (320/330/340/480/540/700)
- Use figmaMono only for eyebrows/captions (uppercase)
- Compose every CTA as a pill, every icon button as a circle
- Return to white canvas between color blocks
- Pair button-primary + button-secondary for primary + secondary actions

### Don't
- No mid-gray text (use weight, not opacity)
- No drop shadows on color-block sections
- No new accent colors outside the block palette + accent-magenta
- No more than one color block visible per viewport
- No square CTAs
- No figmaMono in body copy
- No replacing pricing-tab-selected black with a colored tab

## Iteration Guide
1. Focus on one component at a time by token name
2. Decide the color-block surface first (most consequential decision)
3. Default body to `body` token; reach for `subhead`/`headline` only inside color blocks
4. Keep primary black scarce — two primary CTAs in one viewport means one should be secondary
5. Treat accent-magenta as single-shot: one promo CTA per page
