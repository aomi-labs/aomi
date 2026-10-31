// Shared definitions for the external bot/channel integrations surfaced on the
// Integrations page. Imported by both the client view and the Build server route so the
// two validate against the same provider ids and field shapes.

export type IntegrationProviderId = "telegram" | "discord";

export type IntegrationField = {
  key: string;
  label: string;
  placeholder: string;
  /** Render as a masked input and never echo back from the server. */
  secret: boolean;
  required: boolean;
};

export type IntegrationProvider = {
  id: IntegrationProviderId;
  name: string;
  description: string;
  docsUrl: string;
  fields: IntegrationField[];
};

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: "telegram",
    name: "Telegram",
    description:
      "Send and receive Telegram messages. Create a bot with @BotFather and paste its token.",
    docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        placeholder: "123456789:ABCdefGhIJKlmNoPQRstuVWxyZ",
        secret: true,
        required: true,
      },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    description:
      "Relay messages and deploy alerts. Create an app in the Discord Developer Portal and paste its bot token.",
    docsUrl: "https://discord.com/developers/docs/getting-started",
    fields: [
      {
        key: "botToken",
        label: "Bot token",
        placeholder: "Bot token from the Developer Portal",
        secret: true,
        required: true,
      },
      {
        key: "applicationId",
        label: "Application ID",
        placeholder: "Optional application / client ID",
        secret: false,
        required: false,
      },
    ],
  },
];

export function getIntegrationProvider(
  id: string,
): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDERS.find((provider) => provider.id === id);
}
