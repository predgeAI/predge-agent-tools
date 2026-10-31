import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPredgeTools } from "../packages/langchain/src/index";
import { predgeTools } from "../packages/ai-sdk/src/index";

const record = { risk_level: "ok", market: { slug: "m" }, attestation: {} };
const account = { address: "0x1111111111111111111111111111111111111111", signTypedData: vi.fn() };

beforeEach(() => vi.stubEnv("PREDGE_KEY", ""));
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("AI SDK adapter", () => {
    it("returns only free tools without an account", () => {
        expect(Object.keys(predgeTools())).toEqual(["predgeGetVerdict", "predgeSettlementRisk", "predgeVerifyRecord"]);
    });

    it("adds the verdict tool with a Predge key and no wallet", () => {
        expect(Object.keys(predgeTools({ apiKey: "pdg_pilot_test" }))).toEqual([
            "predgeRequestVerdict",
            "predgeGetVerdict",
            "predgeSettlementRisk",
            "predgeVerifyRecord",
        ]);
    });

    it("adds paid tools with an account unless payments are disabled", () => {
        expect(Object.keys(predgeTools({ account }))).toEqual([
            "predgeRequestVerdict",
            "predgeGetVerdict",
            "predgeSettlementRisk",
            "predgeVerifyRecord",
            "predgeSettlementEstimate",
            "predgeWhaleTrades",
        ]);
        expect(Object.keys(predgeTools({ account, maxPaymentUsd: 0 }))).toHaveLength(3);
    });

    it("executes the settlement-risk tool", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(record)));
        const t = predgeTools().predgeSettlementRisk;
        const out = (await t.execute?.({ market: "5608010" }, { toolCallId: "1", messages: [] } as never)) as Record<
            string,
            unknown
        >;
        expect(fetchMock.mock.calls[0][0]).toBe("https://api.predge.io/v1/settlement-risk/5608010");
        expect(out.risk_level).toBe("ok");
        expect((out.signature as { valid: boolean }).valid).toBe(false);
    });
});

describe("LangChain adapter", () => {
    it("returns structured tools that answer with JSON strings", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(record)));
        const tools = createPredgeTools();
        expect(tools.map((t) => t.name)).toEqual(["predge_get_verdict", "predge_get_settlement_risk", "predge_verify_record"]);
        const out = await tools[1].invoke({ market: "5608010" });
        expect(JSON.parse(out as string).risk_level).toBe("ok");
    });

    it("validates input with the zod schema", async () => {
        const tools = createPredgeTools();
        await expect(tools[1].invoke({ market: "" })).rejects.toThrow();
        await expect(tools[0].invoke({ id: "nope" })).rejects.toThrow();
    });

    it("exposes predge_request_verdict with a key and sends it as x-predge-key", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response(JSON.stringify({ id: "vrd_x", verdict: "delivered", attestation: {} })));
        const tools = createPredgeTools({ apiKey: "pdg_pilot_test" });
        const t = tools.find((x) => x.name === "predge_request_verdict");
        const out = await t?.invoke({
            job: { endpoint: "https://api.example.com/v1/report" },
            delivery: { status: 200, body: "{}" },
            payment: { amount_usd: 0.1 },
        });
        expect(JSON.parse(out as string).verdict).toBe("delivered");
        const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
        expect(init.headers["x-predge-key"]).toBe("pdg_pilot_test");
        await expect(t?.invoke({ job: {}, delivery: {}, payment: { amount_usd: 1 } })).rejects.toThrow();
    });
});
