import { afterEach, describe, expect, it, vi } from "vitest";
import { createPredgeTools } from "../packages/langchain/src/index";
import { predgeTools } from "../packages/ai-sdk/src/index";

const record = { risk_level: "ok", market: { slug: "m" }, attestation: {} };
const account = { address: "0x1111111111111111111111111111111111111111", signTypedData: vi.fn() };

afterEach(() => vi.restoreAllMocks());

describe("AI SDK adapter", () => {
    it("returns only free tools without an account", () => {
        expect(Object.keys(predgeTools())).toEqual(["predgeSettlementRisk", "predgeVerifyRecord"]);
    });

    it("adds paid tools with an account unless payments are disabled", () => {
        expect(Object.keys(predgeTools({ account }))).toEqual([
            "predgeSettlementRisk",
            "predgeVerifyRecord",
            "predgeSettlementEstimate",
            "predgeWhaleTrades",
        ]);
        expect(Object.keys(predgeTools({ account, maxPaymentUsd: 0 }))).toHaveLength(2);
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
        expect(tools.map((t) => t.name)).toEqual(["predge_get_settlement_risk", "predge_verify_record"]);
        const out = await tools[0].invoke({ market: "5608010" });
        expect(JSON.parse(out as string).risk_level).toBe("ok");
    });

    it("validates input with the zod schema", async () => {
        const tools = createPredgeTools();
        await expect(tools[0].invoke({ market: "" })).rejects.toThrow();
    });
});
