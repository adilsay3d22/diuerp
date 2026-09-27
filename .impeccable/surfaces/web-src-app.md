---
version: 1
slug: "web-src-app"
primary_target: "web/src/app"
related_targets: []
---

# Surface brief: ERP app shell (all routes under web/src/app)

Scope: every user-side (/app) and admin-side (/admin) screen. Mode: Operate.
Audience: students and teachers (often phone), office staff (desktop, dense). Equal weight.

## Direction contract

THESIS: Quiet precision, Apple-style. Content sits on soft grey ground in white, generously rounded panels; hierarchy comes from type size and weight, not rules or boxes. User-pinned (replaces The Office Register, judged old-fashioned).

OWN-WORLD: Ground #F5F5F7, white panels radius 16px with hairline shadow; ink #1D1D1F, secondary #6E6E73; Inter; DIU navy (#0F1A34 family) as brand mark and active-state accent, purple #373063 capsule primary buttons; status as soft tinted pills with icon + word; segmented controls for tabs and semester pickers; light translucent sidebar with icons.

STORY: The user sees what is theirs to do first, reads records in calm uncluttered lists, and acts with one obvious control.

FIRST VIEWPORT: Light sidebar (icons + labels, navy active pill) left; translucent top bar with role switcher; large 28px title with grey meta line; primary content panel directly below, primary action top-right. On phones the sidebar becomes a sheet menu.

FORM: User-pinned Apple-esque minimal (overrides seed e00cd29e roll; spec §12a palette kept as accents).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
