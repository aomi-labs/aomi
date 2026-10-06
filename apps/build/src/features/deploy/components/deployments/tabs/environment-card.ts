// =============================================================================
// The project-home Environment card — "is anything actually wrong with keys?"
//
// It used to warn whenever no key was set, which reads as a fault on every app
// that declares no required key at all. The gate the rest of Build enforces is
// narrower: a required slot with no value. This mirrors that gate, and when it
// does warn it names the app and the keys instead of leaving the reader to go
// find them.
// =============================================================================

import type { RequiredSecretsByApp } from "@build/features/launch/required-secrets";
import { BUILD_GLOSSARY } from "@build/lib/glossary";

export type EnvironmentCard = {
  value: string;
  hint: string;
  tone: "good" | "warn" | "neutral";
  /** Required keys are declared but unset — the only state that blocks a deploy. */
  blocked: boolean;
};

/** Keys named in full before the summary elides the rest. */
const NAMED_KEYS = 4;

export function environmentCard({
  apps,
  requiredSecrets,
  requiredSecretsError,
  secretsByApp,
  secretsError,
}: {
  /** Apps to gate on: the source's apps plus any the check itself reported. */
  apps: string[];
  requiredSecrets: RequiredSecretsByApp | null;
  requiredSecretsError: string | null;
  secretsByApp: Record<string, string[]> | null;
  secretsError: string | null;
}): EnvironmentCard {
  const glossary = BUILD_GLOSSARY.environment.meaning;

  if (apps.length === 0) {
    return {
      value: "No apps yet",
      hint: "Deploy an app before configuring its environment keys.",
      tone: "neutral",
      blocked: false,
    };
  }

  // An error is worth reporting on its own terms — saying "keys missing"
  // because a read failed would send the user looking for a key that is fine.
  const error = requiredSecretsError ?? secretsError;
  if (error) {
    return {
      value: "Unavailable",
      hint: `${error} Open Environment to retry.`,
      tone: "warn",
      blocked: false,
    };
  }

  if (secretsByApp === null || (apps.length > 0 && requiredSecrets === null)) {
    return {
      value: "Loading…",
      hint: glossary,
      tone: "neutral",
      blocked: false,
    };
  }

  const missing = missingByApp(apps, requiredSecrets);
  if (missing.length > 0) {
    return {
      value: "Keys missing",
      hint: missingHint(missing),
      tone: "warn",
      blocked: true,
    };
  }

  const setCount = Object.values(secretsByApp).reduce(
    (sum, keys) => sum + keys.length,
    0,
  );
  if (setCount > 0) {
    return {
      value: `${setCount} key${setCount === 1 ? "" : "s"} set`,
      hint: glossary,
      tone: "good",
      blocked: false,
    };
  }

  return {
    value: "No keys required",
    hint: `This project declares no required keys. ${glossary}`,
    tone: "good",
    blocked: false,
  };
}

function missingByApp(
  apps: string[],
  requiredSecrets: RequiredSecretsByApp | null,
): { app: string; keys: string[] }[] {
  if (!requiredSecrets) return [];
  return apps
    .map((app) => ({ app, keys: requiredSecrets[app]?.missing ?? [] }))
    .filter(({ keys }) => keys.length > 0);
}

/** "somm-agent needs OPENAI_API_KEY and 2 more." — enough to act on. */
function missingHint(missing: { app: string; keys: string[] }[]): string {
  const total = missing.reduce((sum, { keys }) => sum + keys.length, 0);
  const named = missing.flatMap(({ keys }) => keys).slice(0, NAMED_KEYS);
  const rest = total - named.length;
  const keys = rest > 0 ? `${named.join(", ")} and ${rest} more` : list(named);
  const apps = list(missing.map(({ app }) => app));
  return `${total} required key${total === 1 ? "" : "s"} not set for ${apps}: ${keys}. Set them in Environment before deploying.`;
}

function list(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
