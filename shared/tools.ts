import { z } from "zod";
import { PredgeAPI, type PredgePluginOptions } from "./client";
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

export type ToolSpec = {
    name: string;
    description: string;
    schema: z.ZodObject;
    paid: boolean;
    run: (api: PredgeAPI, input: Record<string, unknown>, signer: X402Signer | undefined) => Promise<unknown>;
};

export const TOOL_SPECS: ToolSpec[] = [
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
    const specs = TOOL_SPECS.filter((s) => !s.paid || paidEnabled);
    return { api, signer, specs };
}
