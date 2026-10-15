import { describe, expect, it, vi } from "vitest";
import { takeOwnerClaimFromUrl } from "./owner-claim";

function at(href: string) {
  const url = new URL(href);
  return { href: url.href, hash: url.hash };
}

describe("takeOwnerClaimFromUrl", () => {
  it("reads the claim and strips it from the URL", () => {
    const history = { replaceState: vi.fn() };
    const claim = takeOwnerClaimFromUrl(
      at(
        "https://chat.aomi.dev/?app=demo&application_id=42#owner_claim=aomi-claim-abc",
      ),
      history,
    );
    expect(claim).toBe("aomi-claim-abc");
    const [, , url] = history.replaceState.mock.calls[0];
    expect(String(url)).toBe(
      "https://chat.aomi.dev/?app=demo&application_id=42",
    );
  });

  it("keeps other fragment parameters", () => {
    const history = { replaceState: vi.fn() };
    takeOwnerClaimFromUrl(
      at("https://chat.aomi.dev/#owner_claim=c&view=full"),
      history,
    );
    expect(String(history.replaceState.mock.calls[0][2])).toBe(
      "https://chat.aomi.dev/#view=full",
    );
  });

  it("leaves a URL without a claim alone", () => {
    const history = { replaceState: vi.fn() };
    expect(
      takeOwnerClaimFromUrl(at("https://chat.aomi.dev/?app=demo"), history),
    ).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});
