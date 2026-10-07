import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountAvatar } from "./account-avatar";

const render = (seed: string, size?: number) =>
  renderToStaticMarkup(<AccountAvatar seed={seed} size={size} />);

describe("AccountAvatar", () => {
  it("is deterministic and distinguishes account ids", () => {
    expect(render("account-a")).toBe(render("account-a"));
    expect(render("account-a")).not.toBe(render("account-b"));
    expect(
      new Set(Array.from({ length: 16 }, (_, i) => render(`account-${i}`)))
        .size,
    ).toBe(16);
  });

  it("draws a mirrored pattern with at least one tile on each side", () => {
    for (let i = 0; i < 64; i++) {
      const markup = render(`account-${i}`);
      const xs = [...markup.matchAll(/<rect x="([\d.]+)"/g)].map((m) =>
        Number(m[1]),
      );
      const left = xs.filter((x) => x < 15).length;
      const right = xs.filter((x) => x > 25).length;
      expect(left).toBeGreaterThan(0);
      expect(left).toBe(right);
    }
  });

  it("uses the same geometry at every size", () => {
    const small = render("guest-session", 16);
    const large = render("guest-session", 40);
    expect(small.replace('width="16" height="16"', "")).toBe(
      large.replace('width="40" height="40"', ""),
    );
  });

  it("keeps the neutral icon when no account or guest id exists", () => {
    const markup = renderToStaticMarkup(<AccountAvatar size={32} />);
    expect(markup).not.toContain("data-account-avatar");
    expect(markup).toContain("lucide-user-round");
    expect(markup).toContain("width:32px;height:32px");
  });
});
