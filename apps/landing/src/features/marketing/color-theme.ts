/**
 * Pre-hydration theme switch for the whole site.
 *
 * Two consumers read the theme, and they read it two different ways:
 *   - the marketing CSS modules key off `html[data-theme="dark"]`
 *   - Tailwind's `dark:` variant and the shadcn/aomi token palettes
 *     (`.dark { --background: … }` in shadcn-registry/src/themes/default.css)
 *     key off the `.dark` CLASS, which is also what next-themes writes via
 *     Fumadocs' RootProvider on /playground and /examples.
 *
 * This script owns both and keeps them in lockstep. Before it did, the class
 * was never set outside the Fumadocs routes, so on marketing pages
 * `--background` stayed light and the `bg-background` on <html> painted white
 * behind the page (visible on overscroll and before hydration).
 *
 * It also honours the stored next-themes preference rather than reading the
 * media query alone, so it agrees with Fumadocs' own toggle instead of
 * fighting it, and a MutationObserver mirrors any later class change (the
 * toggle, or a client-side nav out of the docs) back into `data-theme`.
 */
export const COLOR_THEME_INIT_SCRIPT = `(() => {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  // next-themes' storage key and value vocabulary ("light" | "dark" | "system").
  const stored = () => {
    try {
      return localStorage.getItem("theme");
    } catch (_) {
      return null;
    }
  };

  const write = (theme) => {
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme !== "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  };

  const apply = () => {
    const pref = stored();
    write(pref === "light" || pref === "dark" ? pref : media.matches ? "dark" : "light");
  };

  apply();
  media.addEventListener?.("change", apply);

  // The class is the source of truth once the page is live: mirror it back into
  // data-theme so the marketing selectors never disagree with the token palette.
  new MutationObserver(() => {
    const theme = root.classList.contains("dark") ? "dark" : "light";
    if (root.dataset.theme !== theme) {
      root.dataset.theme = theme;
      root.style.colorScheme = theme;
    }
  }).observe(root, { attributes: true, attributeFilter: ["class"] });
})();`;
