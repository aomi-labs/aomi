import { describe, expect, it } from "vitest";
import {
  builderSecretSlots,
  missingRequiredSecrets,
  type SecretSlot,
} from "../src/secrets";

const slot = (
  name: string,
  required: boolean,
  userOwn = false,
): SecretSlot => ({
  name,
  description: `${name} description`,
  required,
  user_own: userOwn,
});

describe("missingRequiredSecrets", () => {
  it("returns required slots that have no configured key", () => {
    const missing = missingRequiredSecrets(
      [slot("BINANCE_API_KEY", true), slot("BINANCE_SECRET_KEY", true)],
      ["BINANCE_API_KEY"],
    );
    expect(missing.map((s) => s.name)).toEqual(["BINANCE_SECRET_KEY"]);
  });

  it("never gates on optional slots", () => {
    expect(missingRequiredSecrets([slot("DEBUG", false)], [])).toEqual([]);
  });

  it("leaves user-owned slots to the chat user's setup", () => {
    const slots = [
      slot("BUILDER_KEY", true),
      slot("USER_TRADING_KEY", true, true),
    ];

    expect(builderSecretSlots(slots).map(({ name }) => name)).toEqual([
      "BUILDER_KEY",
    ]);
    expect(missingRequiredSecrets(slots, []).map(({ name }) => name)).toEqual([
      "BUILDER_KEY",
    ]);
  });

  it("returns nothing when every required slot is configured", () => {
    expect(missingRequiredSecrets([slot("A", true)], ["A"])).toEqual([]);
  });

  it("treats undefined or empty slots as no gate", () => {
    expect(missingRequiredSecrets(undefined, [])).toEqual([]);
    expect(missingRequiredSecrets([], [])).toEqual([]);
  });

  it("matches names case-sensitively (env vars are case-sensitive)", () => {
    const missing = missingRequiredSecrets(
      [slot("API_KEY", true)],
      ["api_key"],
    );
    expect(missing.map((s) => s.name)).toEqual(["API_KEY"]);
  });
});
