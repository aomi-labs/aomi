import type { AomiAppDescriptor, AomiSecretSlot } from "../src";

// Existing consumers can still construct Builder-owned manifest slots.
const legacySlot: AomiSecretSlot = {
  name: "BUILDER_TOKEN",
  description: "App service credential",
  required: true,
};
const legacyDescriptor: AomiAppDescriptor = {
  name: "example",
  secrets: [legacySlot],
};
const userSlot: AomiSecretSlot = { ...legacySlot, user_own: true };
void [legacyDescriptor, userSlot];
