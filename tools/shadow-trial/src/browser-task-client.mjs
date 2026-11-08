/** Two independent purchases; never signs or submits execution transactions. */
// Browser adaptation of the existing author's pinned TaskClient. Payment and
// recovery logic retained; only runtime IO/crypto and SDK injection change.
// No wallet, default network transport, automatic purchase or global journal.
import { hash, utf8, text, fromBase64, toBase64, fromBase64Url, concatBytes, verifyEd25519 } from "./browser-crypto.mjs";
















































































































































const CHAINS                                                    = {
  5042: {
    usdc: "0x3600000000000000000000000000000000000000",
    gateway: "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee",
  },
  5042002: {
    usdc: "0x3600000000000000000000000000000000000000",
    gateway: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
  },
};
function requireThat(condition         , message        )                    {
  if (!condition) throw new Error(message);
}
function address(value         )         {
  requireThat(
    typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value),
    "Invalid address",
  );
  return value.toLowerCase();
}
function decimal(value         )         {
  requireThat(
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value),
    "Expected unsigned decimal string",
  );
  return BigInt(value);
}
function stable(value     )         {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function normalized(request             ) {
  const calls = (request.calls ?? []).map((call) => {
    requireThat(/^0x(?:[0-9a-f]{2})*$/i.test(call.data), "Invalid call data");
    return {
      to: address(call.to),
      data: call.data.toLowerCase(),
      value: decimal(call.value).toString(),
    };
  });
  const constraints =
    request.constraints == null
      ? null
      : {
          maxOutgoingUsdcWei: null,
          maxGasUnits: null,
          ...request.constraints,
          allowedTargets: (
            (request.constraints.allowedTargets ?? [])
          ).map(address),
          minimumReceived: (
            (request.constraints.minimumReceived ?? [])
          ).map((x) => ({
            ...x,
            asset: x.asset === "native" ? "native" : address(x.asset),
          })),
        };
  return {
    executionKind: request.executionKind ?? "eoa_transactions",
    transactionSafetyMode: request.transactionSafetyMode ?? null,
    intent: request.intent,
    chainId: String(request.chainId),
    sender: address(request.sender),
    payer: address(request.payer ?? request.sender),
    calls,
    constraints:
      constraints == null
        ? null
        : {
            ...constraints,
            maxGasUnits:
              constraints.maxGasUnits == null
                ? null
                : String(constraints.maxGasUnits),
          },
  };
}
export async function attestation(
  jwt        ,
  jwks                        ,
  subject        ,
  now        ,
)               {
  const parts = jwt.split(".");
  requireThat(parts.length === 3, "Invalid attestation");
  const header = JSON.parse(text(fromBase64Url(parts[0])));
  requireThat(
    header.alg === "EdDSA" &&
      typeof header.kid === "string" &&
      !header.jku &&
      !header.jwk &&
      !header.x5u &&
      !header.crit,
    "Unsupported attestation header",
  );
  const keys = jwks.keys.filter(
    (k) =>
      k.kid === header.kid &&
      k.kty === "OKP" &&
      k.crv === "Ed25519" &&
      (!k.alg || k.alg === "EdDSA") &&
      (!k.use || k.use === "sig"),
  );
  requireThat(keys.length === 1, "No unique explicitly trusted signing key");
  requireThat(
    await verifyEd25519(keys[0], utf8(parts[0] + "." + parts[1]), fromBase64Url(parts[2])),
    "Invalid attestation signature",
  );
  const claims = JSON.parse(text(fromBase64Url(parts[1])));
  requireThat(
    claims.aud === "aomi-task-artifact" &&
      claims.sub === subject &&
      Number.isSafeInteger(claims.iat) &&
      Number.isSafeInteger(claims.exp) &&
      claims.iat <= now + 30 &&
      claims.exp > now &&
      claims.exp > claims.iat,
    "Invalid attestation identity or lifetime",
  );
  return claims;
}
export class TaskClient {
           options         ;
  constructor(options         ) {
    const url = new URL(options.endpoint);
    requireThat(
      url.pathname === "/v1/task/build" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))),
      "Use explicit HTTPS Task endpoint",
    );
    requireThat(
      options.maxPreparationFeeMicrousd >= 0n &&
        options.maxRetrievalFeeMicrousd >= 0n &&
        options.maxTotalFeeMicrousd > 0n,
      "Explicit spending limits required",
    );
    requireThat(typeof options.fetch === "function" && typeof options.signTypedData === "function" && options.journal && options.payments, "Explicit same-runtime journal, payment SDK, transport and signer required");
    this.options = options;
  }
          now() {
    return this.options.now?.() ?? Math.floor(Date.now() / 1000);
  }
          async save(state         ) {
    await this.options.journal.save(state);
  }
          policy(request             ) {
    return {
      endpoint: this.options.endpoint,
      payer: address(this.options.payer),
      recipient: address(this.options.recipient),
      preparationCap: String(this.options.maxPreparationFeeMicrousd),
      retrievalCap: String(this.options.maxRetrievalFeeMicrousd),
      totalCap: String(this.options.maxTotalFeeMicrousd),
      request: normalized(request),
    };
  }
          async locked   (
    work                                ,
    request              ,
  )             {
    return this.options.journal.withLock(async () => {
      let state = await this.options.journal.load()                  ;
      if (state === null) {
        requireThat(request, "Existing Task journal required for recovery");
        requireThat(address(request.payer ?? request.sender) === address(this.options.payer), "Payer mismatch");
        state = {
          version: 2, policy: this.policy(request), request,
          phase: "payment_pending",
          preparation: { id: this.options.payments.generatePaymentId() },
          retrieval: { id: this.options.payments.generatePaymentId() },
        };
        await this.save(state);
      }
      requireThat(state.version === 2, "Unsupported journal version");
      requireThat(stable(state.policy) === stable(this.policy(request ?? state.request)), "Existing purchase or spending policy differs");
      return work(state);
    });
  }
          url(job         , kind                     ) {
    requireThat(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        job.quoteId,
      ),
      "Invalid quote ID",
    );
    const expected = new URL(
      `/v1/task/${job.quoteId}/${kind}`,
      this.options.endpoint,
    ).href;
    requireThat(
      job[kind === "status" ? "statusUrl" : "resultUrl"] === expected,
      "Untrusted Task resource URL",
    );
    return expected;
  }
          check(
    required     ,
    state         ,
    stage                             ,
  ) {
    const chain = CHAINS[state.request.chainId];
    requireThat(
      chain && required.x402Version === 2 && required.accepts?.length === 1,
      "Unsupported payment requirement",
    );
    const accepted = required.accepts[0];
    const amount = decimal(accepted.amount),
      cap =
        stage === "preparation"
          ? this.options.maxPreparationFeeMicrousd
          : this.options.maxRetrievalFeeMicrousd;
    requireThat(
      required.resource?.url ===
        (stage === "preparation"
          ? this.options.endpoint
          : this.url(state.job , "result")) &&
        required.resource.mimeType === "application/json",
      "Unexpected payment resource",
    );
    requireThat(
      accepted.scheme === "exact" &&
        accepted.network === `eip155:${state.request.chainId}` &&
        address(accepted.asset) === chain.usdc &&
        address(accepted.payTo) === address(this.options.recipient),
      "Unexpected payment parties or rail",
    );
    requireThat(
      accepted.extra?.name === "GatewayWalletBatched" &&
        accepted.extra.version === "1" &&
        address(accepted.extra.verifyingContract) === chain.gateway &&
        !accepted.extra.aomiTaskNonce,
      "Unexpected payment domain",
    );
    requireThat(
      Number.isSafeInteger(accepted.extra.minValiditySeconds) &&
        accepted.extra.minValiditySeconds > 0 &&
        accepted.extra.minValiditySeconds <= 691140 &&
        Number.isSafeInteger(accepted.maxTimeoutSeconds) &&
        accepted.maxTimeoutSeconds > 0 &&
        accepted.maxTimeoutSeconds <= 300,
      "Unexpected payment lifetime",
    );
    requireThat(
      amount > 0n &&
        amount <= cap &&
        amount +
          BigInt(
            state[stage === "preparation" ? "retrieval" : "preparation"]
              .amount ?? 0,
          ) <=
          this.options.maxTotalFeeMicrousd,
      "Payment exceeds spending limit",
    );
    requireThat(
      amount ===
        (stage === "preparation"
          ? 10000n
          : decimal(state.preview .pricing.fee_microusd)),
      "Unexpected fee",
    );
    return accepted;
  }
          async preview(value     , state         , now = this.now())                       {
    const claims = await attestation(
      value.attestation,
      this.options.trustedJwks,
      `wallet:eip155:${state.request.chainId}:${address(this.options.payer)}`,
      now,
    );
    requireThat(
      value.quoteId === state.job .quoteId &&
        claims.quoteId === value.quoteId &&
        /^[a-f0-9]{64}$/.test(value.payloadHash) &&
        claims.payloadHash === value.payloadHash,
      "Quote identity mismatch",
    );
    requireThat(
      stable(claims.request) === stable(normalized(state.request)) &&
        stable(value.request) === stable(claims.request),
      "Quote request mismatch",
    );
    requireThat(
      claims.requestHash === value.requestHash &&
        value.requestHash === await hash(stable(normalized(state.request))),
      "Quote request hash mismatch",
    );
    requireThat(
      stable(value.summary) === stable(claims.summary) &&
        stable(value.pricing) === stable(claims.pricing) &&
        value.summary.source.chainId === state.request.chainId,
      "Preview differs from signed claims",
    );
    const fee = decimal(value.pricing.fee_microusd),
      outflow = decimal(value.pricing.outgoing_usdc_wei);
    requireThat(
      decimal(value.summary.outgoingUsdcWei) === outflow &&
        value.summary.requestHash === value.requestHash &&
        value.summary.payerIdentity ===
          `payment:eip155:${state.request.chainId}:${address(this.options.payer)}`,
      "Preview summary binding mismatch",
    );
    requireThat(
      fee === (outflow * 3n + 100000000000000n - 1n) / 100000000000000n &&
        value.pricing.preparation_fee_microusd === "10000" &&
        BigInt(claims.amountMicrousd) === fee,
      "Incorrect retrieval fee",
    );
    requireThat(
      address(claims.payer) === address(this.options.payer) &&
        Number(claims.chainId) === state.request.chainId &&
        claims.exp === value.expiresAt,
      "Quote payer or lifetime mismatch",
    );
    requireThat(
      claims.paymentRequiredHash === await hash(value.paymentRequired ?? ""),
      "Payment requirements differ from attestation",
    );
    state.preview = value;
    if (fee > 0n) {
      const required = JSON.parse(
        text(fromBase64(value.paymentRequired)),
      );
      requireThat(
        required.extensions?.aomiTask?.quoteId === value.quoteId &&
          required.extensions?.aomiTask?.payloadHash === value.payloadHash,
        "Payment quote binding mismatch",
      );
      this.check(required, state, "retrieval");
    }
    return value;
  }
          async bounded(response          ) {
    const reader = response.body?.getReader(),
      chunks               = [];
    let count = 0;
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.length;
        if (count > 4 * 1024 * 1024) {
          await reader.cancel();
          throw Error("Task response too large; retain journal");
        }
        chunks.push(value);
      }
    return new Response(concatBytes(chunks), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
          async http(url        , body         , signature         ) {
    return this.bounded(
      await this.options.fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(signature ? { "payment-signature": signature } : {}),
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }),
    );
  }
          async paid(
    state         ,
    stage                             ,
    url        ,
    body         ,
    allowSign         ,
  ) {
    const purchase = state[stage];
    if (purchase.signature) return this.http(url, body, purchase.signature);
    if (!allowSign) return this.http(url, body);
    const chain = CHAINS[state.request.chainId];
    requireThat(chain, "Unsupported chain");
    const client = this.options.payments.createClient({
      schemes: [
        {
          network: `eip155:${state.request.chainId}`,
          client: this.options.payments.createBatchEvmScheme({
            address: address(this.options.payer)                 ,
            signTypedData: async (data     ) =>
              (await this.options.signTypedData(data))                 ,
          }),
        },
      ],
      spendControls: {
        allowedAssets: [
          {
            network: `eip155:${state.request.chainId}`,
            asset: chain.usdc,
            maxAmountPerPayment: String(
              stage === "preparation"
                ? this.options.maxPreparationFeeMicrousd
                : this.options.maxRetrievalFeeMicrousd,
            ),
          },
        ],
      },
    });
    client.onBeforePaymentCreation(async ({ paymentRequired }                        ) => {
      this.check(paymentRequired, state, stage);
      requireThat(
        paymentRequired.extensions?.["payment-identifier"],
        "Missing payment identifier support",
      );
      this.options.payments.appendPaymentIdentifierToExtensions(
        paymentRequired.extensions,
        purchase.id,
      );
    });
    client.onAfterPaymentCreation(async ({ paymentPayload }                       ) => {
      purchase.signature = toBase64(utf8(JSON.stringify(paymentPayload)));
      purchase.amount = paymentPayload.accepted.amount;
      await this.save(state);
    });
    const transport               = async (input, init) => {
      const request = new Request(input, init);
      requireThat(
        request.url === url &&
          request.method === "POST" &&
          (await request.clone().text()) === JSON.stringify(body),
        "Payment retry changed request",
      );
      const signature = request.headers.get("payment-signature");
      if (signature) {
        requireThat(
          signature === purchase.signature,
          "SDK payment differs from journal",
        );
      }
      const response = await this.bounded(
        await this.options.fetch(request, {
          signal: AbortSignal.timeout(30000),
          redirect: "error",
        }),
      );
      if (stage === "retrieval" && response.status === 402) {
        const preview = await response.clone().json();
        await this.preview(preview, state);
        requireThat(
          response.headers.get("payment-required") === preview.paymentRequired,
          "Payment header mismatch",
        );
        state.verifiedAt = this.now();
        await this.save(state);
      }
      return response;
    };
    return this.options.payments.wrapFetchWithPayment(transport, client)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
    });
  }
          receipt(
    response          ,
    state         ,
    stage                             ,
  ) {
    const header = response.headers.get("payment-response");
    if (!header) return;
    const receipt              = JSON.parse(
      text(fromBase64(header)),
    );
    requireThat(
      receipt.success === true &&
        receipt.network === `eip155:${state.request.chainId}` &&
        address(receipt.payer) === address(this.options.payer) &&
        typeof receipt.transaction === "string" &&
        receipt.transaction.length > 0,
      "Payment receipt mismatch",
    );
    state[stage].receipt = receipt;
  }
          async progress(
    response          ,
    state         ,
  )                        {
    const value = await response.json();
    if (![200, 202].includes(response.status))
      throw Error(
        `Task HTTP ${response.status}: ${value.error?.code ?? "request_failed"}`,
      );
    requireThat(
      ["payment_pending", "preparing", "ready", "failed", "expired"].includes(
        value.status,
      ),
      "Invalid Task status",
    );
    if (value.status === "ready" && !value.purchased) {
      state.preview = await this.preview(value, state);
      state.verifiedAt = this.now();
    }
    if (value.purchased)
      requireThat(
        state.preview && state.retrieval.signature,
        "Missing saved purchase for ready result",
      );
    state.phase = value.status;
    await this.save(state);
    return {
      status: value.status,
      job: state.job,
      preview: value.status === "ready" ? state.preview : undefined,
      error: typeof value.error === "string" ? value.error : undefined,
      retryAfter: value.retryAfter,
    };
  }
          async start(
    state         ,
    allowSign         ,
  )                        {
    if (state.job) return this.poll(state);
    const body = { ...state.request, payer: state.policy.payer };
    const response = await this.paid(
      state,
      "preparation",
      this.options.endpoint,
      body,
      allowSign,
    );
    if (response.status === 402 && !allowSign)
      return { status: "payment_pending" };
    requireThat(
      response.status === 202,
      "Preparation did not return a job; retain payment journal",
    );
    const value = await response.clone().json();
    requireThat(
      typeof value.retrievalToken === "string" &&
        value.retrievalToken.length >= 32,
      "Missing retrieval capability",
    );
    state.job = value;
    this.url(value, "status");
    this.url(value, "result");
    this.receipt(response, state, "preparation");
    await this.save(state);
    // A replay may acknowledge an already-ready job without embedding its
    // signed preview. Retrieve that preview through the unpaid status path.
    if (value.status === "ready") return this.poll(state);
    return this.progress(response, state);
  }
          async poll(state         )                        {
    requireThat(state.job, "Preparation has not returned a job");
    const response = await this.http(this.url(state.job, "status"), {
      retrievalToken: state.job.retrievalToken,
    });
    this.receipt(response, state, "preparation");
    return this.progress(response, state);
  }
          async collect(
    state         ,
    allowSign         ,
  )                      {
    if (state.bytes) {
      const bytes = fromBase64(state.bytes);
      requireThat(
        await hash(bytes) === state.preview?.payloadHash,
        "Stored artifact hash mismatch",
      );
      return { status: "complete", bytes };
    }
    requireThat(state.job, "No preparation job");
    if (!state.retrieval.signature) {
      const progress = await this.poll(state);
      if (progress.status !== "ready") return progress;
    }
    requireThat(
      state.preview && state.verifiedAt !== undefined,
      "No verified preview",
    );
    await this.preview(
      state.preview,
      state,
      state.retrieval.signature ? state.verifiedAt : this.now(),
    );
    const response = await this.paid(
      state,
      "retrieval",
      this.url(state.job, "result"),
      { retrievalToken: state.job.retrievalToken },
      allowSign,
    );
    if (response.status === 402 && !allowSign)
      return { status: "ready", job: state.job, preview: state.preview };
    if (response.status !== 200) return this.progress(response, state);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await hash(bytes) !== state.preview.payloadHash) {
      let value     ;
      try {
        value = JSON.parse(text(bytes));
      } catch {}
      if (["failed", "expired"].includes(value?.status)) {
        state.phase = value.status;
        await this.save(state);
        return { status: value.status, error: value.error, job: state.job };
      }
      throw Error("Paid artifact hash mismatch; retain payment journal");
    }
    this.receipt(response, state, "retrieval");
    if (decimal(state.preview.pricing.fee_microusd) > 0n)
      requireThat(state.retrieval.receipt, "Missing retrieval receipt");
    state.bytes = toBase64(bytes);
    state.phase = "complete";
    await this.save(state);
    return { status: "complete", bytes };
  }
  prepare(request             ) {
    return this.locked((s) => this.start(s, true), request);
  }
  status() {
    return this.locked((s) => this.poll(s));
  }
  retrieve() {
    return this.locked((s) => this.collect(s, true));
  }
  async recover()                      {
    return this.locked(async (s) => {
      if (!s.job) return this.start(s, false);
      if (s.retrieval.signature || s.bytes) return this.collect(s, false);
      return this.poll(s);
    });
  }
  async purchase(request             )                      {
    let progress             = await this.prepare(request);
    const deadline = Date.now() + (this.options.waitMs ?? 100000);
    while (progress.status === "preparing" && Date.now() < deadline) {
      const delay = Math.max(
        1000,
        Math.min(10000, ((progress                ).retryAfter ?? 2) * 1000),
      );
      await new Promise((r) =>
        setTimeout(r, Math.min(delay, Math.max(0, deadline - Date.now()))),
      );
      progress = await this.status();
    }
    return progress.status === "ready" ? this.retrieve() : progress;
  }
}
