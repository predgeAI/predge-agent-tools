import { tool, type ToolSet } from "ai";
import { type PredgeToolsOptions, resolveTools } from "../../../shared/tools";

export * from "../../../shared/index";

const KEYS: Record<string, string> = {
    predge_get_settlement_risk: "predgeSettlementRisk",
    predge_verify_record: "predgeVerifyRecord",
    predge_get_settlement_estimate: "predgeSettlementEstimate",
    predge_get_whale_trades: "predgeWhaleTrades",
};

/**
 * Predge tools for the Vercel AI SDK.
 *
 * Free tools are always returned. Paid tools (x402, USDC on Base) are returned only when an `account` is given.
 *
 * @example
 * const { text } = await generateText({ model, tools: predgeTools(), prompt: "Is market 5608010 safe to settle?" });
 */
export function predgeTools(options: PredgeToolsOptions = {}): ToolSet {
    const { api, signer, specs } = resolveTools(options);
    const tools: ToolSet = {};
    for (const spec of specs) {
        tools[KEYS[spec.name] ?? spec.name] = tool({
            description: spec.description,
            inputSchema: spec.schema,
            execute: async (input: Record<string, unknown>) => spec.run(api, input, signer),
        });
    }
    return tools;
}

/** The free settlement-risk tool on its own. */
export function settlementRisk(options: PredgeToolsOptions = {}) {
    return predgeTools({ ...options, account: undefined }).predgeSettlementRisk;
}
