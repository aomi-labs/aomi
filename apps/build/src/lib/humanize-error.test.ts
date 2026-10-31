import { describe, expect, it } from "vitest";

import { humanizeUserError } from "./humanize-error";

describe("humanizeUserError", () => {
  it("maps auth and not-implemented failures to short copy", () => {
    expect(humanizeUserError("not signed in with GitHub")).toBe(
      "Sign in with GitHub and try again.",
    );
    expect(
      humanizeUserError(
        "Saving Telegram credentials isn't available yet — backend storage is pending.",
      ),
    ).toBe("This isn't available yet.");
    expect(
      humanizeUserError(
        "The backend rejected the Aomi Build service bearer. Set BUILD_SERVICE_PRIVATE_KEY.",
      ),
    ).toBe("Sign-in failed. Try again.");
  });

  it("keeps short human messages and falls back for long noise", () => {
    expect(humanizeUserError("Add at least one KEY and value.")).toBe(
      "Add at least one KEY and value.",
    );
    expect(
      humanizeUserError(
        "x".repeat(200),
        "Could not save. Try again.",
      ),
    ).toBe("Could not save. Try again.");
  });
});
