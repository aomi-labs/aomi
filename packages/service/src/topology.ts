// The AOMI service topology — the TS counterpart of the Rust `aomi-service`
// crate. One committed artifact describes the whole mesh; each service reads it,
// selects its own node, and gets a runtime object that mints (issuer side) and
// verifies (consumer side) AccountBearers. Node-only — it holds a private key.
//
// The token convention and `service.toml` shape are the cross-language contract
// (docs/topics/account-authentication/facts/service-identity.md). This module is
// the issuer-side vantage of the same topology the backend's `service.toml`
// encodes from the verifier side.

import {
  decodeProtectedHeader,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from "jose";
import { parse as parseToml } from "toml";

import { assertServerOnly } from "./server-only";

const ALG = "EdDSA";

/** One node in the mesh: a service's identity and what it may do. */
export type ServiceNode = {
  /** Service identity — the `iss` it signs as / the `aud` others address it by. */
  name: string;
  /** Key id selecting this node's keypair (rotation + multi-issuer). */
  kid: string;
  /** SPKI public key (PEM). The private half lives in that service's env only. */
  publicKey: string;
  /** Roles this service is authorized to mint (`user`/`service`/`admin`). */
  issues: string[];
  /** Services (by `name`) this one may sign bearers for. */
  audiences: string[];
};

export type Topology = { services: ServiceNode[] };

export type AccountBearerClaims = {
  sub: string;
  iss: string;
  aud: string;
  role: string;
  iat: number;
  exp: number;
  /** Delegated public capability context. Absent on legacy internal bearers. */
  scope?: string;
  resource?: string;
  client_id?: string;
  auth_source?: "session" | "oauth" | "legacy_mcp" | "cli_session";
  principal_class?: "user" | "guest";
  grant_id?: string;
  sid?: string;
};

export type DelegatedBearerContext = Pick<
  AccountBearerClaims,
  | "scope"
  | "resource"
  | "client_id"
  | "auth_source"
  | "principal_class"
  | "grant_id"
  | "sid"
>;

const DEFAULT_TTL_SECONDS = 5 * 60;

/** Parse a topology TOML document (the `[[services]]` mesh). */
export function parseTopology(tomlText: string): Topology {
  const raw = parseToml(tomlText) as { services?: unknown };
  const services = Array.isArray(raw.services) ? raw.services : [];
  return {
    services: services.map((node, index) => {
      const n = node as Record<string, unknown>;
      const name = typeof n.name === "string" ? n.name : "";
      if (!name)
        throw new Error(`topology service #${index} is missing a name`);
      return {
        name,
        kid: typeof n.kid === "string" ? n.kid : "",
        publicKey: typeof n.public_key === "string" ? n.public_key : "",
        issues: toStringArray(n.issues),
        audiences: toStringArray(n.audiences),
      };
    }),
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * A service's runtime view of the topology — the TS `AomiService`. Bound to one
 * `self` node; mints as that identity and verifies inbound bearers addressed to
 * it. A partner platform is just a different `selfName` against the same mesh.
 */
export class AomiService {
  private signing: {
    privateKey: Awaited<ReturnType<typeof importPKCS8>>;
    kid: string;
  } | null = null;

  private constructor(
    readonly self: ServiceNode,
    private readonly topology: Topology,
    private readonly privateKeyPem: string | undefined,
  ) {}

  /**
   * Build from a topology TOML, selecting `selfName` as this service. The PKCS#8
   * private key (a secret) is injected here from env — never the TOML.
   */
  static fromTopology(args: {
    toml: string;
    selfName: string;
    privateKeyPem?: string;
  }): AomiService {
    assertServerOnly();
    const topology = parseTopology(args.toml);
    const self = topology.services.find((node) => node.name === args.selfName);
    if (!self) {
      throw new Error(`service "${args.selfName}" is not in the topology`);
    }
    return new AomiService(self, topology, args.privateKeyPem);
  }

  private async signingKey() {
    if (this.signing) return this.signing;
    const pem = this.privateKeyPem?.replaceAll("\\n", "\n").trim();
    if (!pem) {
      throw new Error(
        `signing is not configured for service "${this.self.name}" (missing private key)`,
      );
    }
    this.signing = {
      privateKey: await importPKCS8(pem, ALG),
      kid: this.self.kid,
    };
    return this.signing;
  }

  /**
   * Mint an AccountBearer as this service. Enforces — from config, not the call
   * site — that `self` may assert `role` and may address `audience`.
   */
  async mint(args: {
    role: string;
    subject: string;
    audience: string;
    ttlSeconds?: number;
    delegated?: DelegatedBearerContext;
  }): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.self.issues.includes(args.role)) {
      throw new Error(
        `service "${this.self.name}" is not authorized to mint role "${args.role}"`,
      );
    }
    if (!this.self.audiences.includes(args.audience)) {
      throw new Error(
        `service "${this.self.name}" is not authorized to address audience "${args.audience}"`,
      );
    }
    const { privateKey, kid } = await this.signingKey();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (args.ttlSeconds ?? DEFAULT_TTL_SECONDS);
    const accessToken = await new SignJWT({
      role: args.role,
      ...definedDelegatedClaims(args.delegated),
    })
      .setProtectedHeader({ alg: ALG, kid })
      .setSubject(args.subject)
      .setIssuer(this.self.name)
      .setAudience(args.audience)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(privateKey);
    return { accessToken, expiresAt };
  }

  /**
   * Verify an inbound bearer addressed to this service, returning its claims.
   * The `kid` selects the issuer node; the token must verify against that node's
   * key, carry `aud` = this service, and its `role` must be one the issuer is
   * authorized to mint. (For partner → us calls.)
   */
  async verify(token: string): Promise<AccountBearerClaims> {
    const kid = decodeProtectedHeader(token).kid;
    if (!kid) throw new Error("bearer header carries no kid");
    const issuer = this.topology.services.find((node) => node.kid === kid);
    if (!issuer) throw new Error(`no trusted service for kid "${kid}"`);
    if (!issuer.publicKey.trim()) {
      throw new Error(`trusted service "${issuer.name}" has no public key`);
    }
    if (issuer.issues.length === 0) {
      throw new Error(
        `trusted service "${issuer.name}" is not authorized to issue bearers`,
      );
    }
    const key = await importSPKI(
      issuer.publicKey.replaceAll("\\n", "\n").trim(),
      ALG,
    );
    const { payload } = await jwtVerify(token, key, {
      issuer: issuer.name,
      audience: this.self.name,
      algorithms: [ALG],
    });
    const claims = payload as AccountBearerClaims;
    const role = claims.role ?? "user";
    if (!issuer.issues.includes(role)) {
      throw new Error(
        `issuer "${issuer.name}" is not authorized for role "${role}"`,
      );
    }
    return { ...claims, role };
  }

  /** Verify and require the bearer to carry exactly `requiredRole`. */
  async verifyRole(
    token: string,
    requiredRole: string,
  ): Promise<AccountBearerClaims> {
    const claims = await this.verify(token);
    if (claims.role !== requiredRole) {
      throw new Error(
        `bearer role "${claims.role}" does not satisfy required role "${requiredRole}"`,
      );
    }
    return claims;
  }
}

function definedDelegatedClaims(
  delegated: DelegatedBearerContext | undefined,
): Record<string, string> {
  if (!delegated) return {};
  return Object.fromEntries(
    Object.entries(delegated).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
    ),
  );
}
