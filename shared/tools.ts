import { z } from "zod";
import { PredgeAPI, type PredgePluginOptions, type VerdictRequest } from "./client";
import type { X402Signer } from "./x402";

/** A viem-style account: anything with an address and EIP-712 signTypedData (e.g. privateKeyToAccount). */
export type PredgeAccount = {
    address: string;
    signTypedData: (data: never) => Promise<string>;
};

export type PredgeToolsOptions = PredgePluginOptions & {
    /** Account that pays for paid tools (USDC on Base). Without it only the free tools are returned. */
    account?: PredgeAccount;
    /** EVM chain id the account pays on. Defaults to 8453 (Base). */
    chainId?: number;
};

const market = z
    .string()
    .min(1)
    .describe("Polymarket market: a condition id (0x + 64 hex), a numeric market id, or a market slug");

const optStr = (max: number, d: string) => z.string().min(1).max(max).optional().describe(d);

const agentIdentity = (who: string) =>
    z
        .object({
            id: z.string().min(1).max(256).describe("Stable agent id, e.g. an ERC-8004 id"),
            version: z.string().min(1).max(64).describe("Agent version"),
            operator: z.string().min(1).max(256).describe("Company or wallet accountable for the agent"),
            authorization_ref: optStr(256, "Mandate or policy id the agent acted under"),
        })
        .optional()
        .describe(`Optional know-your-agent record of the ${who}; signed into the verdict as given, not verified by Predge`);

const verdictSchema = z.object({
    job: z
        .object({
            endpoint: z.string().min(1).max(2048).describe("The URL or path that was called and paid for"),
            method: optStr(16, "HTTP method of the paid call, e.g. GET or POST"),
            expected_content_type: optStr(128, "Content type that was promised, e.g. application/json"),
            expect_json: z.boolean().optional().describe("True if the response had to be valid JSON"),
            json_schema: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("JSON Schema the response body had to match"),
            required_fields: z.array(z.string().min(1).max(200)).max(50).optional().describe("Dot-paths that must exist"),
            non_empty_fields: z
                .array(z.string().min(1).max(200))
                .max(50)
                .optional()
                .describe("Dot-paths that must be non-empty"),
            max_latency_ms: z.number().int().min(0).max(3_600_000).optional().describe("Promised maximum latency"),
            expected_sha256: z
                .string()
                .regex(/^[0-9a-fA-F]{64}$/)
                .optional()
                .describe("sha256 (hex) the body had to have"),
        })
        .describe("What was promised"),
    delivery: z
        .object({
            status: z.number().int().min(100).max(599).optional().describe("HTTP status of the delivery"),
            headers: z.record(z.string(), z.string()).optional().describe("Response headers (at most 30)"),
            body: z.string().max(200_000).optional().describe("Response body as text (or send body_sha256 instead)"),
            body_sha256: z
                .string()
                .regex(/^[0-9a-fA-F]{64}$/)
                .optional()
                .describe("sha256 (hex) of the response body"),
            requested_at: optStr(40, "ISO 8601 time the request was sent"),
            responded_at: optStr(40, "ISO 8601 time the response arrived"),
            latency_ms: z.number().int().min(0).max(86_400_000).optional().describe("Measured latency"),
        })
        .describe("The delivery evidence"),
    payment: z
        .object({
            amount_usd: z.number().min(0).describe("USD paid for the job. Under $1: $0.05 verdict; $1 or more: $0.50"),
            tx_hash: optStr(200, "Payment transaction hash"),
            network: optStr(200, "Payment network, e.g. eip155:8453"),
            asset: optStr(200, "Payment asset address or symbol"),
            payer: optStr(200, "Buyer address or id"),
            payee: optStr(200, "Merchant address or id"),
        })
        .describe("The payment reference"),
    buyer_id: optStr(128, "Your id for the buyer"),
    merchant_id: optStr(128, "Your id for the merchant"),
    agent: agentIdentity("buyer agent"),
    provider_agent: agentIdentity("provider (merchant) agent"),
});

export type ToolSpec = {
    name: string;
    description: string;
    schema: z.ZodObject;
    paid: boolean;
    /** Also available without a wallet when a Predge API key is configured. */
    keyed?: boolean;
    run: (api: PredgeAPI, input: Record<string, unknown>, signer: X402Signer | undefined) => Promise<unknown>;
};

export const TOOL_SPECS: ToolSpec[] = [
    {
        name: "predge_request_verdict",
        description:
            "Get a signed delivery verdict for a paid AI-agent call: was the work delivered as promised, and should the payment be refunded? " +
            "Input: job (what was promised: endpoint, expected content type, JSON Schema, required fields, max latency), delivery (the evidence: " +
            "status, headers, body or its sha256, timing) and payment (amount_usd, payer, payee, tx hash). Returns verdict (delivered, " +
            "not_delivered or inconclusive), reason codes, per-check results, a refund recommendation, a verify_url and the ed25519 signature " +
            "check. Deterministic checks of the evidence you send. Free with a Predge pilot key inside its 30-day window; otherwise paid over " +
            "x402: $0.05 when the paid call is under $1, $0.50 at $1 or more. The refund is a recommendation the merchant executes; Predge does " +
            "not move money.",
        schema: verdictSchema,
        paid: true,
        keyed: true,
        run: (api, input, signer) => api.requestVerdict(signer, input as unknown as VerdictRequest),
    },
    {
        name: "predge_get_verdict",
        description:
            "Read a stored Predge delivery verdict by id (vrd_ followed by 24 characters). Free, no key. Returns the verdict, reason codes, " +
            "refund recommendation and the ed25519 signature check, so a buyer, merchant or third party can confirm what was ruled.",
        schema: z.object({
            id: z
                .string()
                .regex(/^vrd_[A-Za-z0-9_-]{24}$/)
                .describe("Verdict id, e.g. vrd_ followed by 24 characters"),
        }),
        paid: false,
        run: (api, input) => api.getVerdict(String(input.id)),
    },
    {
        name: "predge_get_settlement_risk",
        description:
            "Check whether a Polymarket market's resolution is settled, disputed or at risk before trading, paying or settling on it. Free, no API key. Input: condition id (0x...), numeric market id or slug. Returns a record read live from UMA on Polygon and signed by Predge: risk_level (ok, watch, caution, resolved), recommendation, UMA state, disputes, and the ed25519 signature check against Predge's published key. Treat watch or caution as a reason to stop and tell the user. An error or a failed signature is not a 'no risk' answer.",
        schema: z.object({ market }),
        paid: false,
        run: (api, input) => api.getSettlementRisk(String(input.market)),
    },
    {
        name: "predge_verify_record",
        description:
            "Verify a Predge signed record offline (settlement risk, attestation, signed call). Input: the record as a JSON string, either the full API response or its attestation envelope. Checks the ed25519 signature over the canonical bytes against Predge's pinned key (never the key inside the record), the payload, the content hash and the envelope signature. valid is true only if every check passes.",
        schema: z.object({
            record: z.string().min(1).describe("A Predge signed record as a JSON string"),
        }),
        paid: false,
        run: async (api, input) => api.verifyRecord(String(input.record)),
    },
    {
        name: "predge_get_settlement_estimate",
        description:
            "Buy Predge's signed settlement estimate for a Polymarket market: $0.02 USDC per call, paid automatically over x402 from the configured account on Base. Failed requests (400/404/422/502) are not charged. Returns the same signed record as predge_get_settlement_risk plus settlement_estimate: for a market disputed and not yet resolved, the calibrated probability that it settles differently from the disputed proposal. Call predge_get_settlement_risk first and use this only when the market has a dispute.",
        schema: z.object({ market }),
        paid: true,
        run: (api, input, signer) => api.getSettlementEstimate(signer, String(input.market)),
    },
    {
        name: "predge_get_whale_trades",
        description:
            "Buy the latest Polymarket whale trades from Predge: trades of $10,000+ notional with market, side, size, price, wallet and a Predge wallet score, delayed 15 minutes. $0.005 USDC per call, paid automatically over x402 from the configured account on Base. Input: limit (1-100, default 20).",
        schema: z.object({
            limit: z.number().int().min(1).max(100).default(20).describe("Number of trades to return (1-100)"),
        }),
        paid: true,
        run: (api, input, signer) => api.getWhaleTrades(signer, Number(input.limit ?? 20)),
    },
];

/** Builds the API client, the optional signer and the list of tool specs to expose. */
export function resolveTools(options: PredgeToolsOptions = {}) {
    const api = new PredgeAPI(options);
    const account = options.account;
    const signer: X402Signer | undefined = account
        ? {
              address: account.address,
              chainId: options.chainId ?? 8453,
              signTypedData: (data) => account.signTypedData(data as never),
          }
        : undefined;
    const paidEnabled = signer !== undefined && (options.maxPaymentUsd ?? 0.05) > 0;
    const specs = TOOL_SPECS.filter((s) => !s.paid || paidEnabled || (s.keyed === true && api.apiKey !== undefined));
    return { api, signer, specs };
}
