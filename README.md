# Predge agent tools

Dispute and refund verdicts for AI-agent payments, as framework tools for the [Predge API](https://predge.io/docs). An agent that paid for a call can ask for a signed verdict (`delivered` / `not_delivered` / `inconclusive`, with a refund recommendation) and re-read any verdict by id. Also: a signed settlement-risk check for any Polymarket market (free, no key), offline verification of Predge records, and x402-paid Polymarket data.

| Package | Framework |
|---|---|
| [`@predge/ai-sdk`](packages/ai-sdk) | Vercel AI SDK |
| [`@predge/langchain`](packages/langchain) | LangChain.js / LangGraph.js |

Other integrations:

- MCP: [`@predge/whale-data-mcp`](https://www.npmjs.com/package/@predge/whale-data-mcp)
- Coinbase AgentKit: `predge` action provider ([coinbase/agentkit#1572](https://github.com/coinbase/agentkit/pull/1572))
- GOAT: `@goat-sdk/plugin-predge` ([goat-sdk/goat#607](https://github.com/goat-sdk/goat/pull/607))

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

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The shared client in `shared/` (canonical JSON, ed25519 verification, x402 payment) is bundled into each package, so there is no runtime dependency between them.

MIT
