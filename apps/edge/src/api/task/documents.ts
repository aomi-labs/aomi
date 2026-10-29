/**
 * The venue-facing Task discovery documents, each a pure function of the
 * payment terms. Agent registries read /.well-known/agent.json, x402scan reads
 * /.well-known/x402, GET-probing venues read the build metadata, and importers
 * read the Task-only OpenAPI. None of this is the backend's business: the API
 * Server publishes its canonical contract and Payment its terms.
 *
 * Text and shapes are pinned byte for byte by fixtures captured from the API
 * Server that used to serve them (`fixtures/`).
 */
import { copy, Ordered } from "./json";
import { chains, exampleChain, exampleRequest, type TaskTerms } from "./terms";

type Json = Record<string, unknown>;

const DESCRIPTION =
  "Aomi Labs builds the execution harness for onchain finance. Its Task API lets wallet-controlled agents pay 0.01 USDC to prepare and simulate an onchain plan, inspect a seller-attested preview for free, then buy the frozen unsigned transaction bundle for 3% of simulated gross outgoing USDC. The buyer's wallet signs and broadcasts; Aomi never holds keys or funds.";

/** `https://host/` of the payable resource. */
function origin(terms: TaskTerms): URL {
  return new URL("/", terms.resource_url);
}

function at(terms: TaskTerms, path: string): string {
  return new URL(path, origin(terms)).href;
}

function networks(terms: TaskTerms): string[] {
  return chains(terms).map((chain) => `eip155:${chain}`);
}

/** /.well-known/agent.json */
export function agentManifest(terms: TaskTerms): Json {
  return {
    version: "1.4",
    origin: origin(terms).host,
    display_name: "Aomi Labs — Task API",
    description: DESCRIPTION,
    payout_address: terms.pay_to,
    payments: { x402: { networks: chains(terms).map((chain) => ({ network: `eip155:${chain}`, asset: "USDC", contract: terms.asset })) } },
    intents: [
      {
        name: "build_task",
        description:
          "Pay 0.01 USDC to prepare, inspect its simulation and price, then purchase the frozen artifact for 3% of simulated gross outgoing USDC, rounded up to micro-USDC. No transaction execution is included.",
        endpoint: terms.resource_url,
        method: "POST",
      },
    ],
    extensions: {
      aomi: {
        openapi: at(terms, "v1/task/openapi.json"),
        jwks: at(terms, ".well-known/jwks.json"),
        authentication:
          "No TaskAuthorization. Gateway payment proves payer identity; private retrieval tokens grant job access. Bearer credentials are rejected.",
        payment_flow:
          "Pay preparation by retrying the same request, poll the returned status URL for free, then separately pay the result URL with the private token. Payment does not authorize execution.",
        payment_scheme: "GatewayWalletBatched",
        pricing: "0.01 USDC preparation attempt + 3% of simulated gross outgoing USDC; the signed quote is authoritative.",
        testnet_chain_ids: [5042002],
        mainnet_enabled: terms.allow_mainnet,
        verification:
          "Fetch and trust this deployment's public JWKS over HTTPS before verifying seller attestations. Never trust a key supplied by a quote. Discovery is not payment or execution verification.",
      },
    },
  };
}

/**
 * GET /v1/task/build: read-only instructions for the payable POST. It never
 * carries `accepts`; a payable requirement belongs to a body-bound quote.
 */
export function buildMetadata(terms: TaskTerms): Json {
  return {
    endpoint: terms.resource_url,
    method: "POST",
    paymentProtocol: "x402 v2",
    paymentScheme: "GatewayWalletBatched",
    networks: networks(terms),
    asset: terms.asset,
    payTo: terms.pay_to,
    preparationPriceMicroUsdc: "10000",
    retrievalPrice: "3% of simulated gross outgoing USDC, quoted after preparation",
    openapi: at(terms, "v1/task/openapi.json"),
    exampleRequest: exampleRequest(exampleChain(terms)),
    paymentInstructions:
      "POST a valid intent, chainId and sender. Retry that same POST with Payment-Signature from its body-bound 402 challenge. Poll status, then separately purchase the frozen result if quoted.",
  };
}

/** /.well-known/x402 */
export function wellKnownX402(terms: TaskTerms): Json {
  return {
    x402Version: 2,
    paths: {
      "/v1/task/build": {
        methods: ["POST"],
        resource: terms.resource_url,
        metadata: terms.resource_url,
        payment: buildMetadata(terms),
        quoteBound: true,
      },
    },
  };
}

const TASK_PATHS = ["/.well-known/jwks.json", "/v1/task/build", "/v1/task/{quoteId}/status", "/v1/task/{quoteId}/result"];

const BUILD_GET = {
  operationId: "discoverTaskPayment",
  security: [],
  summary: "Read-only Task payment metadata",
  description:
    "Returns public instructions for the payable POST. A valid POST returns a body-bound x402 v2 Payment-Required challenge; a GET cannot buy preparation and does not advertise a payable challenge. No signature or authorization is required for this metadata.",
  responses: {
    "200": {
      description: "Task payment metadata",
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: [
              "endpoint", "method", "paymentProtocol", "paymentScheme", "networks", "asset",
              "preparationPriceMicroUsdc", "retrievalPrice", "openapi", "exampleRequest", "paymentInstructions",
            ],
            properties: {
              endpoint: { type: "string", format: "uri" },
              method: { const: "POST" },
              paymentProtocol: { type: "string" },
              paymentScheme: { type: "string" },
              networks: { type: "array", items: { type: "string" } },
              asset: { type: "string" },
              preparationPriceMicroUsdc: { type: "string" },
              retrievalPrice: { type: "string" },
              openapi: { type: "string", format: "uri" },
              exampleRequest: {
                type: "object",
                description: "Unsigned JSON body that reaches the body-bound preparation challenge on an enabled network.",
              },
              paymentInstructions: { type: "string" },
            },
          },
        },
      },
    },
    default: { $ref: "#/components/responses/Error" },
  },
};

/**
 * /v1/task/openapi.json: the API Server's canonical contract projected to the
 * Task paths and the components they reach, with the deployed networks and
 * one probe example that importers (x402scan) turn into a working request.
 * `canonical` is the API Server's /openapi.json parsed with `parseOrdered`.
 */
export function taskOpenapi(terms: TaskTerms, canonical: Ordered): Ordered {
  const source = canonical.at("paths");
  const paths = new Ordered(TASK_PATHS.map((path) => [path, copy(source.at(path))]));
  // The read-only GET comes first, as it always has.
  const build = paths.at("/v1/task/build");
  build.delete("get");
  paths.set("/v1/task/build", new Ordered([["get", copy(BUILD_GET)], ...build]));

  const components = new Ordered();
  const pending = references(paths);
  const seen = new Set<string>();
  while (pending.length) {
    const reference = pending.pop()!;
    if (seen.has(reference)) continue;
    seen.add(reference);
    const [root, group, name, ...rest] = reference.replace(/^#\//, "").split("/");
    const value = canonical.at("components").at(group).get(name);
    if (root !== "components" || rest.length || value === undefined)
      throw new Error(`unresolved Task OpenAPI reference ${reference}`);
    if (!components.has(group)) components.set(group, new Ordered());
    components.at(group).set(name, copy(value));
    pending.push(...references(value));
  }

  const example = exampleRequest(exampleChain(terms));
  const json = paths.at("/v1/task/build").at("post").at("requestBody").at("content").at("application/json");
  const properties = json.at("schema").at("properties");
  properties.at("chainId").set("enum", chains(terms));
  // Importers otherwise turn the first allowed chain into a misleading sample.
  properties.at("intent").set("example", example.intent);
  properties.at("chainId").set("example", example.chainId);
  properties.at("sender").set("example", example.sender);
  json.set("example", example);

  return new Ordered([
    ["openapi", "3.1.0"],
    ["info", {
      title: "Aomi Labs Task API",
      version: "1.0.0",
      description:
        "Aomi Labs builds the execution harness for onchain finance. The Task API lets wallet-controlled agents pay 0.01 USDC to prepare and simulate an onchain plan, inspect the seller-attested preview for free, then buy the frozen unsigned bundle for 3% of simulated gross outgoing USDC. The buyer's wallet signs and broadcasts; Aomi never holds keys or funds.",
      "x-guidance":
        "POST intent, chainId and sender to /v1/task/build. Pay 0.01 USDC by repeating the same request with Payment-Signature. Save quoteId and private retrievalToken. Poll the supplied status URL for free; verify the signed preview and price with trusted JWKS. POST the token to the result URL and pay its 3% fee with a second same-body retry. Zero outflow needs no second payment. Persist a separate payment-identifier and signed proof per purchase; never replace an ambiguous payment. No TaskAuthorization is required and no transaction execution is included.",
      contact: { url: "https://aomi.dev/agents", email: "contact@foameo.ai" },
    }],
    ["externalDocs", {
      url: "https://aomi.dev/docs/integrate/task-api",
      description: "Task API integration guide and two-purchase payment flow",
    }],
    ["servers", [{ url: origin(terms).origin }]],
    ["paths", paths],
    ["components", components],
  ]);
}

/** Every `$ref` under `value`, in document order (the API Server's walk). */
function references(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) references(item, found);
  else if (value instanceof Map) {
    const ref = value.get("$ref");
    if (typeof ref === "string") found.push(ref);
    for (const child of value.values()) references(child, found);
  } else if (value && typeof value === "object") {
    const ref = (value as Json).$ref;
    if (typeof ref === "string") found.push(ref);
    for (const child of Object.values(value)) references(child, found);
  }
  return found;
}
