# @predge/ai-sdk

[Predge](https://predge.io) tools for the [Vercel AI SDK](https://ai-sdk.dev). Before your agent trades, pays or settles on a Polymarket market, it can check whether that market's resolution is settled, disputed or at risk. Records are read live from UMA's Optimistic Oracle on Polygon and signed with ed25519. Every signature is verified against Predge's published key.

The free tools need no API key and no wallet.

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
npm install @predge/ai-sdk ai zod
```

## Usage

```ts
import { generateText, stepCountIs } from "ai";
import { predgeTools } from "@predge/ai-sdk";

const { text } = await generateText({
  model: "openai/gpt-5-mini",
  prompt: "Is Polymarket market 5608010 safe to settle against? Check its settlement risk first.",
  tools: predgeTools(),
  stopWhen: stepCountIs(3),
});

console.log(text);
```

### Paid tools (x402, USDC on Base)

Pass an account and the paid tools are added. Any viem account works, e.g. `privateKeyToAccount`.

```ts
import { privateKeyToAccount } from "viem/accounts";
import { predgeTools } from "@predge/ai-sdk";

const tools = predgeTools({
  account: privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`),
  maxPaymentUsd: 0.05, // per-call cap; 0 disables paid tools
});
```

Payments use x402 v2 (`exact` scheme, EIP-3009 USDC authorization on Base). The tool pays only USDC on the account's chain and never more than `maxPaymentUsd` per call.

## Tools

| Key | Tool name | Price | What it does |
|---|---|---|---|
| `predgeSettlementRisk` | `predge_get_settlement_risk` | free | Signed settlement-risk record for a market (condition id, numeric id or slug): `risk_level` (`ok`, `watch`, `caution`, `resolved`), UMA state, disputes, signature check |
| `predgeVerifyRecord` | `predge_verify_record` | free | Verifies a Predge signed record offline against the pinned key |
| `predgeSettlementEstimate` | `predge_get_settlement_estimate` | $0.02 | Same record plus `settlement_estimate`: for a disputed market, the calibrated probability that it settles differently from the disputed proposal. Failed requests are not charged |
| `predgeWhaleTrades` | `predge_get_whale_trades` | $0.005 | Latest Polymarket trades of $10,000+ notional, delayed 15 minutes |

An error, or a record whose signature does not verify, is never a "no risk" answer. The tool output says so.

## Verifying records yourself

```ts
import { verifyPredgeRecord } from "@predge/ai-sdk";

const res = await fetch("https://api.predge.io/v1/settlement-risk/5608010");
console.log(verifyPredgeRecord(await res.json())); // { valid: true, kid: "13fa3d18a369e6c7", checks: {...} }
```

## Links

- API docs: https://predge.io/docs
- OpenAPI: https://api.predge.io/openapi.json
- Signing keys: https://api.predge.io/.well-known/predge-keys.json
- Canonicalization spec: https://data.predge.io/canonicalization.md

MIT
