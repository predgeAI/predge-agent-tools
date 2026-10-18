# @predge/langchain

[Predge](https://predge.io) tools for [LangChain.js](https://js.langchain.com) and LangGraph.js. Before your agent trades, pays or settles on a Polymarket market, it can check whether that market's resolution is settled, disputed or at risk. Records are read live from UMA's Optimistic Oracle on Polygon and signed with ed25519. Every signature is verified against Predge's published key.

The free tools need no API key and no wallet.

## Install

```bash
npm install @predge/langchain @langchain/core zod
```

## Usage

```ts
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { createPredgeTools } from "@predge/langchain";

const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-5-mini" }),
  tools: createPredgeTools(),
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Check the settlement risk of Polymarket market 5608010." }],
});
```

Each tool returns a JSON string.

### Paid tools (x402, USDC on Base)

```ts
import { privateKeyToAccount } from "viem/accounts";

const tools = createPredgeTools({
  account: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`),
  maxPaymentUsd: 0.05, // per-call cap; 0 disables paid tools
});
```

Payments use x402 v2 (`exact` scheme, EIP-3009 USDC authorization on Base). The tool pays only USDC on the account's chain and never more than `maxPaymentUsd` per call.

## Tools

| Tool | Price | What it does |
|---|---|---|
| `predge_get_settlement_risk` | free | Signed settlement-risk record for a market: `risk_level` (`ok`, `watch`, `caution`, `resolved`), UMA state, disputes, signature check |
| `predge_verify_record` | free | Verifies a Predge signed record offline against the pinned key |
| `predge_get_settlement_estimate` | $0.02 | Same record plus `settlement_estimate` for a disputed market. Failed requests are not charged |
| `predge_get_whale_trades` | $0.005 | Latest Polymarket trades of $10,000+ notional, delayed 15 minutes |

## Links

- API docs: https://predge.io/docs
- OpenAPI: https://api.predge.io/openapi.json
- Signing keys: https://api.predge.io/.well-known/predge-keys.json

MIT
