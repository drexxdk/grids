---
description: "Use when writing or editing Tailwind CSS utilities, React UI classes, or resolving suggestCanonicalClasses diagnostics."
applyTo: "apps/web/src/**/*.tsx,apps/web/styles.css"
---

# Tailwind 4 Classes

- Use standard, unprefixed Tailwind utilities.
- Prefer Tailwind 4 canonical utilities over equivalent arbitrary values: `min-h-11` instead of `min-h-[44px]`, and `w-(--viewport-width,100vw)` instead of `w-[var(--viewport-width,100vw)]`.
- After editing UI classes, inspect editor diagnostics with `get_errors`. Act on `tailwindcss(suggestCanonicalClasses)` recommendations in the touched files before finishing.
- Preserve variants, important modifiers, and computed styles. Keep arbitrary values when no semantics-preserving canonical utility exists.
- Recheck diagnostics after applying recommendations. Validate relevant layout or interaction behavior when rewriting utilities.
- Do not hide or disable canonical-class diagnostics to make the warnings disappear.
