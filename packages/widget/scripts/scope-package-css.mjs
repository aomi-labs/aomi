/** Scope the compiled Tailwind output, including reset, tokens and animation names. */
export function scopePackageCss(root) {
  const names = new Map();
  root.walkAtRules(/keyframes$/, (rule) => {
    const name = rule.params;
    names.set(name, `aomi-widget-${name}`);
    rule.params = names.get(name);
  });
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name))
      return;
    // Tailwind v4 keeps nested selectors; their parent has already been scoped.
    if (rule.parent?.type === "rule") {
      rule.selector = rule.selector.replace(
        /:is\(\.dark \*\)/g,
        ":is(.aomi-widget.dark *, .dark .aomi-widget:not(.light) *)",
      );
      return;
    }
    rule.selectors = rule.selectors.map((selector) => {
      if (
        selector === ".aomi-widget" ||
        selector.startsWith(".aomi-widget:has(")
      )
        return selector;
      if (selector === ":root" || selector === ":host" || selector === "html")
        return ".aomi-widget";
      if (selector === ":root.dark")
        return ".aomi-widget.dark, .dark .aomi-widget:not(.light)";
      if (selector === ".light")
        return ".aomi-widget.light, .light .aomi-widget";
      if (selector === ".dark")
        return ".aomi-widget.dark, .dark .aomi-widget:not(.light)";
      if (selector === "body") return ".aomi-widget";
      return `.aomi-widget ${selector}`;
    });
  });
  root.walkDecls((decl) => {
    decl.prop = decl.prop.replace(/--tw-/g, "--aomi-tw-");
    decl.value = decl.value.replace(/--tw-/g, "--aomi-tw-");
    if (
      /^animation(-name)?$/.test(decl.prop) ||
      decl.prop.startsWith("--animate-")
    ) {
      for (const [name, scoped] of names) {
        decl.value = decl.value.replace(
          new RegExp(`\\b${name}\\b`, "g"),
          scoped,
        );
      }
    }
  });
  root.walkAtRules("property", (rule) => {
    rule.params = rule.params.replace(/--tw-/g, "--aomi-tw-");
  });
  // Unlayered host element rules must not outrank our scoped reset and utilities.
  root.walkAtRules("layer", (rule) => {
    if (rule.nodes) rule.replaceWith(...rule.nodes);
    else rule.remove();
  });
  root.walkComments((comment) => comment.remove());
  // Explicit host text rules otherwise beat inheritance inside the widget.
  // Keep this below our element rules and utilities in specificity, and ahead
  // of them in source order, so existing widget typography keeps its values.
  root.prepend({
    selector: ".aomi-widget :where(*), .aomi-widget [contenteditable]",
    nodes: ["font-family", "font-size", "line-height", "color"].map((prop) => ({
      prop,
      value: "inherit",
    })),
  });
  root.prepend({
    selector: ".aomi-widget",
    nodes: [{ prop: "font-size", value: "1rem" }],
  });
}
