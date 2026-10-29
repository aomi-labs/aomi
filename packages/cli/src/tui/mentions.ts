import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type SlashCommand,
} from "@earendil-works/pi-tui";
import {
  appendCapabilityHints,
  capabilityHintPayload,
  CHAIN_NAMES,
  conciseSkillDescription,
  isTestnetChain,
  mentionGroups,
  parseSkillCatalog,
  shortAddress,
  skillLabel,
  SUPPORTED_CHAIN_IDS,
  type Aomi,
  type AomiAccountWallet,
  type MentionItem,
} from "@aomi-labs/client";

const titleize = (id: string) =>
  id
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

/** Everything "@" can tag, as the composer's picker lists it. */
export async function mentionCatalog(
  aomi: Aomi,
  thread: string,
): Promise<MentionItem[]> {
  const [apps, skills, wallets] = await Promise.all([
    aomi.raw.getApps(thread).catch(() => []),
    aomi.raw
      .getPublicCatalog("skills")
      .then(parseSkillCatalog)
      .catch(() => []),
    aomi.auth.mode === "guest"
      ? []
      : aomi.account.wallets.list().catch(() => [] as AomiAccountWallet[]),
  ]);
  const chainName = (id: number) => CHAIN_NAMES[id] ?? String(id);
  return [
    ...apps
      .filter((app) => app.name !== "orchestrator")
      .map((app): MentionItem => {
        const label = app.label?.trim() || titleize(app.name);
        const id =
          app.applicationId !== null && app.applicationId !== undefined
            ? `application:${app.applicationId}`
            : `name:${app.name}`;
        return {
          kind: "app",
          id,
          label,
          appName: app.name,
          description:
            app.featureCatalog?.[0] && titleize(app.featureCatalog[0]),
          searchText: `${app.name} ${label} ${(app.chainIds ?? []).map(chainName).join(" ")}`,
        };
      }),
    ...skills.map(
      (skill): MentionItem => ({
        kind: "skill",
        id: skill.id,
        label: skillLabel(skill),
        description: conciseSkillDescription(skill.description),
        searchText: `${skill.name} ${skill.description} ${skill.tags.join(" ")} ${skill.chainIds.map(chainName).join(" ")}`,
      }),
    ),
    ...SUPPORTED_CHAIN_IDS.map(
      (id): MentionItem => ({
        kind: "chain",
        id: `eip155:${id}`,
        label: chainName(id),
        description: `EVM · chain ${id}`,
        searchText: `${chainName(id)} evm ${id}`,
        testnet: isTestnetChain({ id, name: chainName(id) }),
      }),
    ),
    {
      kind: "chain",
      id: "solana:solana-mainnet",
      label: "Solana",
      description: "Solana network · mainnet",
      searchText: "Solana solana svm solana-mainnet",
    },
    ...walletItems(wallets),
  ];
}

/** One row per wallet: an agent wallet's EVM and SVM keys are one wallet. */
function walletItems(wallets: readonly AomiAccountWallet[]): MentionItem[] {
  const groups = new Map<string, AomiAccountWallet[]>();
  for (const wallet of wallets) {
    const key = wallet.agent_wallet_id ?? wallet.id;
    groups.set(key, [...(groups.get(key) ?? []), wallet]);
  }
  return [...groups.values()].map((own) => ({
    kind: "wallet",
    id: own[0]!.id,
    walletIds: own.map((wallet) => wallet.id),
    label: own[0]!.label,
    description: own
      .map((wallet) => `${shortAddress(wallet.address)} ${wallet.family}`)
      .join(" · "),
    searchText: `${own[0]!.label} ${own.map((wallet) => wallet.address).join(" ")}`,
  }));
}

/** An "@" being typed right before the cursor, and its query. */
const AT = /(?:^|[\s([{<`])@([^\s@]*)$/u;

/**
 * Slash commands as pi-tui completes them, and "@" over the mention catalog,
 * ranked as the composer's picker ranks it. Picked mentions are remembered
 * until `hint` turns them into the send's model hint.
 */
export class MentionAutocomplete implements AutocompleteProvider {
  readonly triggerCharacters = ["@"];
  private readonly slash: CombinedAutocompleteProvider;
  private readonly picked = new Map<string, MentionItem>();

  constructor(
    commands: SlashCommand[],
    private readonly catalog: () => readonly MentionItem[],
  ) {
    this.slash = new CombinedAutocompleteProvider(commands, process.cwd());
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ) {
    const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
    const at = AT.exec(before);
    if (!at)
      return lines.join("\n").trimStart().startsWith("/")
        ? this.slash.getSuggestions(lines, cursorLine, cursorCol, options)
        : null;
    const items = mentionGroups(this.catalog(), at[1]!).flatMap((group) =>
      group.items.map(
        (item): AutocompleteItem => ({
          value: `${item.kind}:${item.id}`,
          label: `@${item.label}`,
          description: [group.label.replace(/s$/u, ""), item.description]
            .filter(Boolean)
            .join(" · "),
        }),
      ),
    );
    return items.length ? { items, prefix: `@${at[1]}` } : null;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    if (!prefix.startsWith("@"))
      return this.slash.applyCompletion(
        lines,
        cursorLine,
        cursorCol,
        item,
        prefix,
      );
    const mention = this.catalog().find(
      (entry) => `${entry.kind}:${entry.id}` === item.value,
    );
    if (mention) this.picked.set(mention.label, mention);
    const line = lines[cursorLine] ?? "";
    const start = cursorCol - prefix.length;
    const text = `${item.label} `;
    const next = [...lines];
    next[cursorLine] = line.slice(0, start) + text + line.slice(cursorCol);
    return { lines: next, cursorLine, cursorCol: start + text.length };
  }

  /** `text` with the model hint for the mentions still in it; forgets them. */
  hint(text: string): string {
    const kept = [...this.picked.values()].filter((item) =>
      text.includes(`@${item.label}`),
    );
    this.picked.clear();
    return appendCapabilityHints(text, capabilityHintPayload(kept));
  }
}
