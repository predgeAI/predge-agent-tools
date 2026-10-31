# @predge/langchain

Dispute and refund verdicts for AI-agent payments, as [LangChain.js](https://js.langchain.com) and LangGraph.js tools. When your agent pays for a call and the result looks wrong, it sends what was promised, what came back and what was paid, and gets a signed [Predge](https://predge.io) verdict: `delivered`, `not_delivered` or `inconclusive`, with reason codes and a refund recommendation. Every verdict is ed25519-signed and checked against Predge's published key.

Also included: a free signed settlement-risk check for Polymarket markets (read live from UMA's Optimistic Oracle on Polygon) and x402-paid Polymarket data.

## Get a free key

Free pilot key in a minute: https://predge.io/start (no card)

First call: a signed delivery verdict for a paid agent call.

```bash
export PREDGE_KEY=pdg_pilot_...   # from predge.io/start
curl -s https://api.predge.io/v1/verdicts \
  -H 'content-type: application/json' \
  -H "x-predge-key: $PREDGE_KEY" \
  -d '{"job":{"endpoint":"https://api.example.com/v1/report","expected_content_type":"application/json","required_fields":["rows"]},
       "delivery":{"status":200,"headers":{"content-type":"application/json"},"body":"{\"rows\":[1]}"},
       "payment":{"amount_usd":0.25,"payer":"0xBuyer","payee":"0xMerchant"}}'
```

The response carries `verdict` (`delivered` / `not_delivered` / `inconclusive`), `reason_codes`, an ed25519 `attestation` and a `verify_url`. Docs: [predge.io/docs#verdicts](https://predge.io/docs#verdicts).

No key? Pay per call over x402 instead: the same request without `x-predge-key` answers 402 with the price ($0.05), payable in USDC by any x402 client.

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
  tools: createPredgeTools({ apiKey: process.env.PREDGE_KEY }), // free pilot key: https://predge.io/start
});

const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content:
        "I paid $0.25 to https://api.example.com/v1/report for JSON with a `rows` field. " +
        'It answered 200 with body {"error":"timeout"}. Ask Predge for a verdict and tell me if I should get a refund.',
    },
  ],
});
```

Without `apiKey` the tools read `PREDGE_KEY` from the environment. Without any key, `predge_request_verdict` is only returned when an account is configured (x402, below); the free tools need nothing. The refund is a recommendation the merchant executes. Predge does not move money.

Each tool returns a JSON string.

### Paid tools (x402, USDC on Base)

```ts
import { privateKeyToAccount } from "viem/accounts";

const tools = createPredgeTools({
  account: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`),
  maxPaymentUsd: 0.05, // per-call cap; 0 disables paid tools
});
```

With an account and no key, `predge_request_verdict` pays per verdict ($0.05 when the paid call is under $1; $0.50 at $1 or more, which needs `maxPaymentUsd: 0.5`). Payments use x402 v2 (`exact` scheme, EIP-3009 USDC authorization on Base). The tool pays only USDC on the account's chain and never more than `maxPaymentUsd` per call.

## Tools

| Tool | Price | What it does |
|---|---|---|
| `predge_request_verdict` | free with a pilot key; else $0.05 (< $1) / $0.50 (>= $1) | Signed delivery verdict for a paid call: `delivered` / `not_delivered` / `inconclusive`, reason codes, per-check results, refund recommendation, `verify_url` |
| `predge_get_verdict` | free | Reads a stored verdict by id (`vrd_...`) and checks its signature |
| `predge_get_settlement_risk` | free | Signed settlement-risk record for a market: `risk_level` (`ok`, `watch`, `caution`, `resolved`), UMA state, disputes, signature check |
| `predge_verify_record` | free | Verifies a Predge signed record offline against the pinned key |
| `predge_get_settlement_estimate` | $0.02 | Same record plus `settlement_estimate` for a disputed market. Failed requests are not charged |
| `predge_get_whale_trades` | $0.005 | Latest Polymarket trades of $10,000+ notional, delayed 15 minutes |

## Links

- API docs: https://predge.io/docs
- OpenAPI: https://api.predge.io/openapi.json
- Signing keys: https://api.predge.io/.well-known/predge-keys.json

MIT
