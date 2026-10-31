import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PredgeAPI } from "../shared/client";
import {
    PREDGE_ATTESTATION_PUBLIC_KEY,
    PREDGE_REVOKED_KEYS,
    canonicalJson,
    verifyBodySignature,
    verifyPredgeRecord,
} from "../shared/verify";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const TEST_KEY = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32).toString("hex");
const signHex = (m: string) => sign(null, Buffer.from(m, "utf8"), privateKey).toString("hex");
// biome-ignore lint/suspicious/noExplicitAny: test assertions on loosely typed results
type Json = Record<string, any>;
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ID = "vrd_abcdefghijklmnopqrstuvwx";

function envelope(payload: Record<string, unknown>, key = TEST_KEY) {
    const canonical = canonicalJson(payload);
    const env: Record<string, unknown> = {
        version: "predge-attest-v1",
        public_key: key,
        canonical,
        signature: signHex(canonical),
        payload,
        kid: key.slice(0, 16),
    };
    env.envelope_signature = signHex(canonicalJson(env));
    return env;
}

function verdictBody(verdict = "not_delivered") {
    const refund = verdict === "not_delivered";
    return {
        id: ID,
        verdict,
        method: "schema",
        reason_codes: refund ? ["missing_required_field"] : [],
        checks: [{ id: "required_fields", status: refund ? "fail" : "pass", reason_code: refund ? "missing_required_field" : null }],
        refund_recommended: refund,
        refund_amount_usd: refund ? "0.250000" : "0.000000",
        refund: {
            recommended: refund,
            amount_usd: refund ? "0.250000" : "0.000000",
            from: refund ? "0xMerchant" : null,
            to: refund ? "0xBuyer" : null,
            status: "recommendation_only",
            instructions: "x",
            onchain: null,
            note: "n",
        },
        issued_at: "2026-10-31T00:00:00.000Z",
        verify_url: `https://api.predge.io/v1/verdicts/${ID}`,
        fee: { tier: "standard", access: "pilot_key", price_usd: "0.000000" },
        attestation: envelope({ kind: "verdict", verdict_id: ID, verdict }),
    };
}

const request = {
    job: { endpoint: "https://api.example.com/v1/report", required_fields: ["rows"] },
    delivery: { status: 200, headers: { "content-type": "application/json" }, body: "{}" },
    payment: { amount_usd: 0.25, payer: "0xBuyer", payee: "0xMerchant" },
};

const signed = (body: unknown, extra: Record<string, string> = {}, status = 200) => {
    const text = JSON.stringify(body);
    const header = `kid=${TEST_KEY.slice(0, 16)}; alg=ed25519; sig=${signHex(`predge-body-v1\n${text}`)}`;
    return new Response(text, { status, headers: { "x-predge-body-signature": header, ...extra } });
};

const paymentRequired = (amount: string) =>
    Buffer.from(
        JSON.stringify({
            x402Version: 2,
            resource: { url: "https://api.predge.io/v1/verdicts" },
            accepts: [
                {
                    scheme: "exact",
                    network: "eip155:8453",
                    asset: BASE_USDC,
                    amount,
                    payTo: "0x9084f5000e07c7133d6da5ee4f271ab6d1821144",
                    maxTimeoutSeconds: 60,
                    extra: { name: "USD Coin", version: "2" },
                },
            ],
        }),
    ).toString("base64");

const signer = () => ({
    address: "0x1111111111111111111111111111111111111111",
    chainId: 8453,
    signTypedData: vi.fn().mockResolvedValue("0xsig"),
});

beforeEach(() => vi.stubEnv("PREDGE_KEY", ""));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("requestVerdict", () => {
    it("posts the request with x-predge-key and verifies the signed verdict", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(signed(verdictBody()));
        const api = new PredgeAPI({ trustedKeys: [TEST_KEY], apiKey: "pdg_pilot_test" });
        const out = (await api.requestVerdict(undefined, request)) as Json;
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe("https://api.predge.io/v1/verdicts");
        expect(init.method).toBe("POST");
        expect(init.headers["x-predge-key"]).toBe("pdg_pilot_test");
        expect(JSON.parse(String(init.body))).toEqual(request);
        expect(out).toMatchObject({
            id: ID,
            verdict: "not_delivered",
            refund_recommended: true,
            refund: { recommended: true, amount_usd: "0.250000", to: "0xBuyer", status: "recommendation_only" },
            verify_url: `https://api.predge.io/v1/verdicts/${ID}`,
        });
        expect(out.signature.valid).toBe(true);
        expect(out.signature.bodySignature).toBe(true);
    });

    it("reads the key from PREDGE_KEY", async () => {
        vi.stubEnv("PREDGE_KEY", "pdg_pilot_env");
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(signed(verdictBody()));
        await new PredgeAPI({ trustedKeys: [TEST_KEY] }).requestVerdict(undefined, request);
        const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
        expect(init.headers["x-predge-key"]).toBe("pdg_pilot_env");
    });

    it("routes paid calls of $1 or more to the large tier", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(signed(verdictBody("delivered")));
        const api = new PredgeAPI({ trustedKeys: [TEST_KEY], apiKey: "pdg_pilot_test" });
        await api.requestVerdict(undefined, { ...request, payment: { amount_usd: 1 } });
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.predge.io/v1/verdicts/large");
    });

    it("refuses without a key or a wallet, and never as a verdict", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch");
        const out = (await new PredgeAPI().requestVerdict(undefined, request)) as Json;
        expect(out.error).toBe(true);
        expect(out.message).toContain("predge.io/start");
        expect(out.verdict).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tells the caller when the key has no free verdicts left and no wallet is set", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 402 }));
        const out = (await new PredgeAPI({ apiKey: "pdg_pilot_old" }).requestVerdict(undefined, request)) as Json;
        expect(out).toMatchObject({ error: true, status: 402 });
    });

    it("pays $0.05 over x402 without a key, posting the same body", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response("{}", { status: 402, headers: { "payment-required": paymentRequired("50000") } }))
            .mockResolvedValueOnce(
                signed(verdictBody(), {
                    "payment-response": Buffer.from(JSON.stringify({ success: true })).toString("base64"),
                }),
            );
        const s = signer();
        const out = (await new PredgeAPI({ trustedKeys: [TEST_KEY] }).requestVerdict(s, request)) as Json;
        expect(out.verdict).toBe("not_delivered");
        expect(out.payment).toEqual({ success: true });
        const paidInit = fetchMock.mock.calls[1][1] as RequestInit & { headers: Record<string, string> };
        expect(paidInit.method).toBe("POST");
        expect(JSON.parse(String(paidInit.body))).toEqual(request);
        expect(paidInit.headers["PAYMENT-SIGNATURE"]).toBeTruthy();
        expect(paidInit.headers["x-predge-key"]).toBeUndefined();
        expect(s.signTypedData.mock.calls[0][0].message.value).toBe(50000n);
    });

    it("does not pay the $0.50 large tier above the default cap", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("{}", { status: 402, headers: { "payment-required": paymentRequired("500000") } }),
        );
        const s = signer();
        const out = (await new PredgeAPI().requestVerdict(s, { ...request, payment: { amount_usd: 5 } })) as Json;
        expect(out.error).toBe(true);
        expect(out.message).toContain("nothing was paid");
        expect(s.signTypedData).not.toHaveBeenCalled();
    });

    it("passes API errors through", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ error: "invalid_request", message: "job.endpoint is required" }), { status: 400 }),
        );
        const out = (await new PredgeAPI({ apiKey: "k" }).requestVerdict(undefined, request)) as Json;
        expect(out).toMatchObject({ error: true, status: 400, code: "invalid_request" });
    });
});

describe("getVerdict", () => {
    it("reads a stored verdict by id and verifies it", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(signed(verdictBody("delivered")));
        const out = (await new PredgeAPI({ trustedKeys: [TEST_KEY] }).getVerdict(ID)) as Json;
        expect(fetchMock.mock.calls[0][0]).toBe(`https://api.predge.io/v1/verdicts/${ID}`);
        expect(out.verdict).toBe("delivered");
        expect(out.signature.valid).toBe(true);
    });
});

describe("signing keys", () => {
    it("pins the current published key and never trusts a revoked one", () => {
        expect(PREDGE_ATTESTATION_PUBLIC_KEY.startsWith("3b6551a6439b9bda")).toBe(true);
        expect(PREDGE_REVOKED_KEYS).not.toContain(PREDGE_ATTESTATION_PUBLIC_KEY);
        const record = { attestation: envelope({ kind: "verdict" }) };
        // Pretend TEST_KEY were revoked by passing a record whose public_key is on the revoked list.
        const revoked = PREDGE_REVOKED_KEYS[0];
        const forged = { attestation: { ...(record.attestation as Json), public_key: revoked } };
        const v = verifyPredgeRecord(forged, [revoked]);
        expect(v.valid).toBe(false);
        expect(v.error).toContain("revoked");
        expect(verifyBodySignature("{}", `kid=${revoked.slice(0, 16)}; alg=ed25519; sig=00`, [revoked])).toBe(false);
    });
});
