import { describe, expect, it } from "vitest";
import {
  appIdentityKey,
  isOfficialAppDescriptor,
  normalizeAppDescriptor,
} from "../src/app-descriptor";

describe("Library app descriptor contract", () => {
  it("normalizes explicit features and trusted registration metadata", () => {
    const official = normalizeAppDescriptor({
      name: "aave",
      application_id: 7,
      metadata: { registered_via: "official_source" },
      feature_catalog: ["lending", "lending", "unknown"],
    });
    expect(official).toMatchObject({
      applicationId: 7,
      featureCatalog: ["lending"],
    });
    expect(isOfficialAppDescriptor(official!)).toBe(true);

    const community = normalizeAppDescriptor({
      name: "aave",
      application_id: 8,
      metadata: { registered_via: "activate_apps" },
      feature_catalog: [],
    });
    expect(isOfficialAppDescriptor(community!)).toBe(false);
    expect(appIdentityKey(official!)).not.toBe(appIdentityKey(community!));
  });

  it("normalizes user-owned secret declarations and defaults ownership off", () => {
    expect(
      normalizeAppDescriptor({
        name: "venue",
        secrets: [
          {
            name: " VENUE_KEY ",
            description: " Personal API key ",
            required: true,
            user_own: true,
          },
          { name: "SHARED_TOKEN", required: true },
          { name: "", user_own: true },
        ],
      })?.secrets,
    ).toEqual([
      {
        name: "VENUE_KEY",
        description: "Personal API key",
        required: true,
        user_own: true,
      },
      {
        name: "SHARED_TOKEN",
        description: "",
        required: true,
        user_own: false,
      },
    ]);
  });
});
