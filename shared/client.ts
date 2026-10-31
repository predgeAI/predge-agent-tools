import { PREDGE_ATTESTATION_PUBLIC_KEY, verifyBodySignature, verifyPredgeRecord } from "./verify";
import { type X402Signer, fetchWithX402 } from "./x402";

export type PredgePluginOptions = {
    /** Predge API base URL. Defaults to https://api.predge.io */
    baseUrl?: string;
    /** Maximum USD a paid tool may pay per call. Defaults to 0.05; 0 disables paid tools. */
    maxPaymentUsd?: number;
    /** Trusted ed25519 public keys (hex). Defaults to Predge's published attestation key. */
    trustedKeys?: string[];
    /**
     * Predge API key, sent as the `x-predge-key` header on verdict requests. A free 30-day pilot key is at
     * https://predge.io/start . Defaults to the PREDGE_KEY environment variable. Without a key, verdicts are paid over x402.
     */
    apiKey?: string;
};

/** Header that carries a Predge API key (pilot / Desk key). */
export const PREDGE_KEY_HEADER = "x-predge-key";
/** A paid call of this many USD or more is a large-tier verdict (POST /v1/verdicts/large, $0.50). */
export const LARGE_VERDICT_THRESHOLD_USD = 1;

/** Body of POST /v1/verdicts: what was promised, what was delivered, and what was paid. */
export type VerdictRequest = {
    job: Json & { endpoint: string };
    delivery: Json;
    payment: Json & { amount_usd: number };
    buyer_id?: string;
    merchant_id?: string;
    agent?: Json;
    provider_agent?: Json;
};

type Json = Record<string, unknown>;

function parseJson(text: string): Json | null {
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" ? (parsed as Json) : null;
    } catch {
        return null;
    }
}

/** The fields of a settlement-risk record an agent needs to decide whether to act. */
export function summarizeSettlementRisk(record: Json): Json {
    const market = (record.market ?? {}) as Json;
    const block = (record.block ?? {}) as Json;
    const segment = (record.segment_dispute_rate ?? null) as Json | null;
    return {
        market: {
            condition_id: market.condition_id,
            market_id: market.market_id,
            slug: market.slug,
            question: market.question,
            closed: market.closed,
        },
        risk_level: record.risk_level,
        recommendation: record.recommendation,
        uma_state: record.uma_state,
        resolved_on_chain: record.resolved_on_chain,
        onchain_resolution: record.onchain_resolution,
        paused: record.paused,
        dispute_count: record.dispute_count,
        open_dispute: record.open_dispute,
        sent_to_uma_vote: record.sent_to_uma_vote,
        current_proposal: record.current_proposal,
        checked_at: record.checked_at,
        block: block.number,
        ...(segment
            ? { segment_dispute_rate: { segment: segment.segment, rate: segment.rate, ci95: segment.ci95 } }
            : {}),
        ...(record.settlement_estimate !== undefined ? { settlement_estimate: record.settlement_estimate } : {}),
    };
}

/** The fields of a signed verdict an agent needs to act on it. */
export function summarizeVerdict(record: Json): Json {
    const refund = (record.refund ?? {}) as Json;
    return {
        id: record.id,
        verdict: record.verdict,
        method: record.method,
        reason_codes: record.reason_codes,
        checks: record.checks,
        refund_recommended: record.refund_recommended,
        refund: {
            recommended: refund.recommended ?? record.refund_recommended,
            amount_usd: refund.amount_usd ?? record.refund_amount_usd,
            from: refund.from,
            to: refund.to,
            status: refund.status,
            instructions: refund.instructions,
        },
        issued_at: record.issued_at,
        verify_url: record.verify_url,
        fee: record.fee,
    };
}

function apiError(status: number, data: Json | null, url: string) {
    return {
        error: true,
        status,
        code: data?.error,
        message: (data?.message as string | undefined) ?? `Predge API request failed with status ${status}`,
        note: "An error is not a 'no risk' answer.",
        url,
    };
}

export class PredgeAPI {
    private readonly baseUrl: string;
    private readonly maxPaymentUsd: number;
    private readonly trustedKeys: string[];
    readonly apiKey: string | undefined;

    constructor(options: PredgePluginOptions = {}) {
        this.baseUrl = (options.baseUrl ?? "https://api.predge.io").replace(/\/+$/, "");
        this.maxPaymentUsd = options.maxPaymentUsd ?? 0.05;
        this.trustedKeys = options.trustedKeys ?? [PREDGE_ATTESTATION_PUBLIC_KEY];
        const envKey = typeof process !== "undefined" ? process.env?.PREDGE_KEY : undefined;
        this.apiKey = (options.apiKey ?? envKey)?.trim() || undefined;
    }

    /**
     * Ask Predge for a signed delivery verdict: was the paid work delivered as promised?
     * Sends the key (x-predge-key) when one is configured; otherwise, or when the key has no free verdicts left
     * (402), pays over x402 from the signer, never above maxPaymentUsd. Calls of $1 or more go to the large tier.
     */
    async requestVerdict(signer: X402Signer | undefined, request: VerdictRequest) {
        const amount = Number(request.payment?.amount_usd);
        const large = Number.isFinite(amount) && amount >= LARGE_VERDICT_THRESHOLD_USD;
        const url = `${this.baseUrl}/v1/verdicts${large ? "/large" : ""}`;
        const body = JSON.stringify(request);
        const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
        if (this.apiKey) headers[PREDGE_KEY_HEADER] = this.apiKey;

        let response: Response;
        if (this.apiKey) {
            response = await fetch(url, { method: "POST", headers, body });
            if (response.status === 402 && !(signer && this.maxPaymentUsd > 0)) {
                return {
                    error: true,
                    status: 402,
                    message:
                        "This key has no free verdicts left (pilot window over). Pay per verdict over x402 by configuring an EVM account, " +
                        "or get a key at https://predge.io/start . Nothing was charged.",
                    url,
                };
            }
        } else {
            if (this.maxPaymentUsd <= 0 || !signer) {
                return {
                    error: true,
                    message:
                        "A verdict needs a Predge key (free pilot key at https://predge.io/start, option apiKey or env PREDGE_KEY) " +
                        "or an EVM account to pay over x402 ($0.05 under $1, $0.50 at $1 or more).",
                };
            }
            response = new Response(null, { status: 402 });
        }
        if (response.status === 402 && signer) {
            try {
                ({ response } = await fetchWithX402(
                    url,
                    signer,
                    BigInt(Math.floor(this.maxPaymentUsd * 1_000_000)),
                    fetch,
                    { method: "POST", body, headers },
                ));
            } catch (e) {
                return { error: true, message: (e as Error).message, url };
            }
        }
        const text = await response.text();
        const data = parseJson(text);
        if (!response.ok || !data) return apiError(response.status, data, url);
        return { ...this.verdictResult(data, text, response), source: url };
    }

    /** Re-read a stored verdict by id (free, no key). Verifies its signature. */
    async getVerdict(id: string) {
        const url = `${this.baseUrl}/v1/verdicts/${encodeURIComponent(id)}`;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        const text = await response.text();
        const data = parseJson(text);
        if (!response.ok || !data) return apiError(response.status, data, url);
        return { ...this.verdictResult(data, text, response), source: url };
    }

    private verdictResult(data: Json, text: string, response: Response) {
        const paymentHeader = response.headers.get("payment-response");
        let payment: unknown = null;
        if (paymentHeader) {
            payment = parseJson(Buffer.from(paymentHeader, "base64").toString("utf8")) ?? { raw: paymentHeader };
        }
        return {
            ...summarizeVerdict(data),
            signature: {
                ...verifyPredgeRecord(data, this.trustedKeys),
                bodySignature: verifyBodySignature(text, response.headers.get("x-predge-body-signature"), this.trustedKeys),
            },
            payment,
        };
    }

    async getSettlementRisk(market: string) {
        const url = `${this.baseUrl}/v1/settlement-risk/${encodeURIComponent(market)}`;
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        const text = await response.text();
        const data = parseJson(text);
        if (!response.ok || !data) return apiError(response.status, data, url);
        return {
            ...summarizeSettlementRisk(data),
            signature: {
                ...verifyPredgeRecord(data, this.trustedKeys),
                bodySignature: verifyBodySignature(
                    text,
                    response.headers.get("x-predge-body-signature"),
                    this.trustedKeys,
                ),
            },
            source: url,
        };
    }

    verifyRecord(record: string) {
        const parsed = parseJson(record);
        if (!parsed) return { valid: false, error: "Record is not valid JSON" };
        return verifyPredgeRecord(parsed, this.trustedKeys);
    }

    async getSettlementEstimate(signer: X402Signer | undefined, market: string) {
        const url = `${this.baseUrl}/v1/settlement-risk/${encodeURIComponent(market)}/estimate`;
        return this.paid(signer, url, (data) => ({
            ...summarizeSettlementRisk(data),
            signature: verifyPredgeRecord(data, this.trustedKeys),
        }));
    }

    async getWhaleTrades(signer: X402Signer | undefined, limit = 20) {
        return this.paid(signer, `${this.baseUrl}/v1/whales/latest?limit=${limit}`, (data) => data);
    }

    private async paid(signer: X402Signer | undefined, url: string, shape: (data: Json) => unknown) {
        if (this.maxPaymentUsd <= 0) {
            return { error: true, message: "Paid Predge tools are disabled (maxPaymentUsd is 0)" };
        }
        if (!signer) {
            return { error: true, message: "Paid Predge tools need an EVM wallet on Base" };
        }
        const { response } = await fetchWithX402(url, signer, BigInt(Math.floor(this.maxPaymentUsd * 1_000_000)));
        const data = parseJson(await response.text());
        if (!response.ok || !data) return apiError(response.status, data, url);
        const paymentHeader = response.headers.get("payment-response");
        let payment: unknown = null;
        if (paymentHeader) {
            payment = parseJson(Buffer.from(paymentHeader, "base64").toString("utf8")) ?? { raw: paymentHeader };
        }
        return { ...(shape(data) as object), payment, source: url };
    }
}
