import { type StructuredToolInterface, tool } from "@langchain/core/tools";
import { type PredgeToolsOptions, resolveTools } from "../../../shared/tools";

export * from "../../../shared/index";

/**
 * Predge tools for LangChain.js / LangGraph.js.
 *
 * Free tools are always returned. Paid tools (x402, USDC on Base) are returned only when an `account` is given.
 * The verdict tool is also returned with a Predge key (`apiKey` or env PREDGE_KEY; free pilot key at predge.io/start).
 * Each tool returns a JSON string.
 *
 * @example
 * const agent = createReactAgent({ llm, tools: createPredgeTools() });
 */
export function createPredgeTools(options: PredgeToolsOptions = {}): StructuredToolInterface[] {
    const { api, signer, specs } = resolveTools(options);
    return specs.map((spec) =>
        tool(async (input: Record<string, unknown>) => JSON.stringify(await spec.run(api, input, signer)), {
            name: spec.name,
            description: spec.description,
            schema: spec.schema,
        }),
    );
}
