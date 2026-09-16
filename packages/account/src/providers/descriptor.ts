import { z } from "zod";
import type { AttestedWallet } from "./wallet-attestation";

export type VerifiedProviderIdentity = {
  provider: string;
  issuerEnvironment: string;
  tenantId: string;
  subject: string;
  expiresAt: number;
  email?: { value: string; verified: boolean };
  walletAttestations: AttestedWallet[];
  metadata: Record<string, unknown>;
};

export type WidgetProviderPolicy = {
  subjectIsEnvironmentGlobal: boolean;
  widgetEnabled: boolean;
};

export const widgetCredentialWireSchema = z.object({
  provider: z.string().trim().min(1),
  environment: z.string().trim().min(1),
  provider_token: z.string().min(1),
  key_id: z.string().trim().min(1).optional(),
});

export type WidgetCredentialWire = z.infer<typeof widgetCredentialWireSchema>;

export type WidgetProviderDescriptor = {
  id: string;
  credentialSchema: z.ZodType<WidgetCredentialWire>;
  verifyWidgetCredential(input: {
    environment: string;
    providerToken: string;
    keyId?: string;
  }): Promise<VerifiedProviderIdentity>;
  policy: WidgetProviderPolicy;
};

const widgetProviders = new Map<string, WidgetProviderDescriptor>();

export function registerWidgetProvider(
  descriptor: WidgetProviderDescriptor,
): void {
  const id = descriptor.id.trim().toLowerCase();
  if (!id) throw new Error("Widget provider id is required");
  const existing = widgetProviders.get(id);
  if (existing && existing !== descriptor) {
    throw new Error(`Widget provider already registered: ${id}`);
  }
  widgetProviders.set(id, descriptor);
}

export function getWidgetProvider(id: string): WidgetProviderDescriptor | null {
  return widgetProviders.get(id.trim().toLowerCase()) ?? null;
}
