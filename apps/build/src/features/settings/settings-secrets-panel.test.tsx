import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { SettingsSecretsPanel } from "./settings-secrets-panel";

it("sends secrets to the package pages", () => {
  render(<SettingsSecretsPanel />);
  expect(screen.getByRole("link", { name: /open packages/i })).toHaveAttribute(
    "href",
    "/packages",
  );
});
