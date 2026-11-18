/**
 * The Library icon rule, as the release check applies it (`aomi-registry`
 * `icon.rs`, with the same messages). Build runs it on an icon before the
 * builder commits it, so a release never fails on the icon.
 */

const CAP = 32 * 1024;

/** The properties that carry a colour; each is `currentColor` or `none`. */
const COLOURS = ["fill", "stroke", "color", "stop-color", "flood-color", "lighting-color"];

const BANNED = ["script", "foreignObject", "image", "style"];

/** The rule `name` with contents `bytes` breaks, or null when it passes. */
export function checkIcon(name: string, bytes: Uint8Array): string | null {
  if (!name.toLowerCase().endsWith(".svg")) return "the icon must be an .svg file";
  if (bytes.length > CAP) return `the icon is ${bytes.length} bytes; the limit is 32 KB`;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return "the icon is not UTF-8 text";
  }
  const lower = text.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<!entity")) {
    return "DOCTYPE and ENTITY declarations are not allowed";
  }
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return "the icon is not well-formed XML";
  const root = doc.documentElement;
  if (root.localName !== "svg") return "the root element must be <svg>";
  const box = (root.getAttribute("viewBox") ?? "").split(/[ ,\t\n\r]/).filter(Boolean).map(Number);
  if (!(box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[2] === box[3])) {
    return "the <svg> needs a square viewBox";
  }
  const walker = doc.createTreeWalker(
    doc,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof ProcessingInstruction) {
      return `the processing instruction <?${node.target}?> is not allowed`;
    }
    const element = node as Element;
    const banned = BANNED.find((tag) => tag.toLowerCase() === element.localName.toLowerCase());
    if (banned) return `<${banned}> is not allowed`;
    for (const attribute of Array.from(element.attributes)) {
      const broken = checkAttribute(attribute.localName, attribute.value);
      if (broken) return broken;
    }
  }
  return null;
}

/** One attribute: no event handler, nothing outside the file, no colour but
 * `currentColor`. A `style` attribute is checked declaration by declaration. */
function checkAttribute(name: string, value: string): string | null {
  if (name.toLowerCase().startsWith("on")) return `the event attribute ${name} is not allowed`;
  if (name === "href" && !value.trimStart().startsWith("#")) {
    return "an href outside the file is not allowed";
  }
  if (value.includes("\\")) return "a CSS escape is not allowed";
  const outside = value
    .toLowerCase()
    .split("url(")
    .slice(1)
    .some((rest) => !rest.trimStart().replace(/^["']+/, "").startsWith("#"));
  if (outside) return "a url() outside the file is not allowed";
  const declarations: [string, string][] =
    name === "style"
      ? value
          .split(";")
          .filter((declaration) => declaration.includes(":"))
          .map((declaration) => {
            const at = declaration.indexOf(":");
            return [declaration.slice(0, at), declaration.slice(at + 1)];
          })
      : [[name, value]];
  for (const [rawProperty, rawColour] of declarations) {
    const [property, colour] = [rawProperty.trim(), rawColour.trim()];
    if (
      COLOURS.includes(property.toLowerCase()) &&
      !["currentcolor", "none"].includes(colour.toLowerCase())
    ) {
      return `the colour ${property}: ${colour} is not allowed; use currentColor or none`;
    }
  }
  return null;
}
