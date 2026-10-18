# Predge agent tools

Framework adapters for the [Predge API](https://predge.io/docs). They give an agent a signed settlement-risk check for any Polymarket market (free, no key), offline verification of Predge records, and x402-paid Polymarket data.

| Package | Framework |
|---|---|
| [`@predge/ai-sdk`](packages/ai-sdk) | Vercel AI SDK |
| [`@predge/langchain`](packages/langchain) | LangChain.js / LangGraph.js |

Other integrations:

- MCP: [`@predge/whale-data-mcp`](https://www.npmjs.com/package/@predge/whale-data-mcp)
- Coinbase AgentKit: `predge` action provider ([coinbase/agentkit#1572](https://github.com/coinbase/agentkit/pull/1572))
- GOAT: `@goat-sdk/plugin-predge` ([goat-sdk/goat#607](https://github.com/goat-sdk/goat/pull/607))

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The shared client in `shared/` (canonical JSON, ed25519 verification, x402 payment) is bundled into each package, so there is no runtime dependency between them.

MIT
