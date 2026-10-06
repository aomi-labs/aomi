# Registry transition

Install the widget through `@aomi-labs/widget`. The copy-in shadcn registry is
frozen; builds no longer regenerate or deploy it. The existing 36 JSON files
in `apps/landing/public/r` remain served by Landing for the first release of
the package transition, so existing registry URLs remain available.

Before retiring `/r/*`, inspect several weeks of request analytics for those
paths. Keep the snapshot or redirect to the install documentation until active
consumers have migrated. Local implementation does not establish hosted usage;
no traffic check or hosted retirement has occurred in this change.

The widget's Radix-based UI primitives remain part of the package. Removing the
copy-in generator does not remove those components.
