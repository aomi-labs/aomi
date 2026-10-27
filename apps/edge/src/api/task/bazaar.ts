/**
 * x402 Bazaar catalogs a paid resource from the `bazaar` extension of its
 * challenge. Only the public preparation POST is listed: a result URL needs a
 * private retrieval token and is never a standalone paid service.
 *
 * Payment signs nothing in `extensions` except what the API Server binds
 * (`aomiTask`), so the edge may add this listing to Payment's challenge. The
 * decoration is idempotent: the same input gives the same bytes whether or not
 * Payment already added it.
 */
import { sortedJson, stringifyOrdered } from "./json";
import { exampleRequest } from "./terms";

type Challenge = {
  resource?: { url?: unknown };
  accepts?: { network?: unknown }[];
  extensions?: Record<string, unknown>;
};

function listing(chainId: number) {
  return {
    info: { input: { type: "http", method: "POST", bodyType: "json", body: exampleRequest(chainId) } },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "http" },
            method: { type: "string", enum: ["POST"] },
            bodyType: { type: "string", enum: ["json"] },
            body: { type: "object" },
          },
          required: ["type", "method", "bodyType", "body"],
          additionalProperties: false,
        },
      },
      required: ["input"],
    },
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function decode(header: string): Challenge | null {
  try {
    const value: unknown = JSON.parse(decoder.decode(Uint8Array.from(atob(header), (c) => c.charCodeAt(0))));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Challenge) : null;
  } catch {
    return null;
  }
}

// Payment's serde_json keeps keys sorted; so does the re-encoded challenge.
function encode(challenge: Challenge): string {
  return btoa(String.fromCharCode(...encoder.encode(sortedJson(challenge))));
}

/** The `Payment-Required` header with the Bazaar listing, or the header unchanged when it is not a preparation challenge. */
export function withBazaar(header: string): string {
  const challenge = decode(header);
  const url = challenge?.resource?.url;
  const network = challenge?.accepts?.[0]?.network;
  const chain = typeof network === "string" ? /^eip155:(\d+)$/.exec(network)?.[1] : undefined;
  if (!challenge || typeof url !== "string" || !url.endsWith("/v1/task/build") || !chain) return header;
  challenge.extensions = { ...challenge.extensions, bazaar: listing(Number(chain)) };
  return encode(challenge);
}

/**
 * A preparation 402 as a venue sees it: the listing in the header and in the
 * body's copy of it. Anything else passes through untouched.
 */
export async function listOnBazaar(response: Response): Promise<Response> {
  const header = response.headers.get("payment-required");
  if (response.status !== 402 || !header) return response;
  const decorated = withBazaar(header);
  if (decorated === header) return response;
  const headers = new Headers(response.headers);
  headers.set("payment-required", decorated);
  headers.delete("content-length");
  let body: string | null = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>).paymentRequired === header)
      body = stringifyOrdered({ ...(parsed as Record<string, unknown>), paymentRequired: decorated });
  } catch {
    // Not the API Server's JSON body: only the header is the venue's contract.
  }
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
