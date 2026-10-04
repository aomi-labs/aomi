import { identifierUrl, type IdentifierReference } from "./explorer-links";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
};

/** Fill gaps only for identifiers associated with a source chain/type.
 * Conflicting chain, type, or local provenance suppresses that identifier.
 * Preserve authored links and code examples; only standalone inline IDs qualify.
 */
export function remarkOnchainIdentifiers(
  references: readonly IdentifierReference[] = [],
) {
  const candidates = new Map<string, string | null>();
  for (const reference of references) {
    // A block number can also be an amount or count elsewhere in the reply.
    // Preserve authored block links; never infer them from numeric text.
    if (reference.kind === "block") continue;
    const url = identifierUrl(reference);
    const previous = candidates.get(reference.identifier);
    candidates.set(
      reference.identifier,
      previous === undefined ? url : previous === url ? url : null,
    );
  }
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (
        [
          "link",
          "linkReference",
          "code",
          "html",
          "image",
          "imageReference",
        ].includes(node.type)
      )
        return;
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type === "inlineCode") {
          const url = candidates.get(child.value ?? "");
          return url ? [{ type: "link", url, children: [child] }] : [child];
        }
        if (child.type !== "text") {
          visit(child);
          return [child];
        }
        const text = child.value ?? "";
        // Consume a complete alphanumeric identifier, never a valid prefix of a
        // malformed value. URLs and identifiers embedded in prose words stay intact.
        const parts: MarkdownNode[] = [];
        let offset = 0;
        for (const match of text.matchAll(
          /(?<![\w/.\-])(?:0x[\da-zA-Z]+|[1-9A-HJ-NP-Za-km-z]{32,88})(?![\w]|\.[\da-zA-Z])/g,
        )) {
          const identifier = match[0];
          const url = candidates.get(identifier);
          if (!url) continue;
          const index = match.index!;
          if (index > offset)
            parts.push({ type: "text", value: text.slice(offset, index) });
          parts.push({
            type: "link",
            url,
            children: [{ type: "text", value: identifier }],
          });
          offset = index + identifier.length;
        }
        if (!offset) return [child];
        if (offset < text.length)
          parts.push({ type: "text", value: text.slice(offset) });
        return parts;
      });
    }
    visit(tree);
  };
}
