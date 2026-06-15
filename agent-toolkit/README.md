# Universa Agent Toolkit

The Universa Agent Toolkit is the agent-operable layer for Universa payout rails. It wraps the existing signed Universa API with:

- a small dependency-light JavaScript SDK,
- approval-safe agent tool functions,
- a stdio MCP server for Codex, Claude Desktop, Cursor, and other MCP clients,
- dry-run defaults for every mutating action.

## What Agents Can Do

| Tool | Purpose | Live Mutation |
| --- | --- | --- |
| `universa_healthcheck` | Confirm toolkit configuration and safety defaults. | No |
| `universa_create_customer` | Create a customer record. | Requires `execute: true` |
| `universa_get_customer` | Read a customer and wallet summary. | No |
| `universa_create_kyc_session` | Create hosted KYC session. | Requires `execute: true` |
| `universa_get_customer_wallet` | Read the assigned Solana wallet. | No |
| `universa_create_virtual_account` | Create a VA that settles to assigned Solana USDC. | Requires `execute: true` |
| `universa_list_virtual_accounts` | List a customer's virtual accounts. | No |
| `universa_prepare_usdc_payout_account` | Shortcut for USD in, Solana USDC out. | Requires `execute: true` |
| `universa_create_quote` | Create a route quote. | Requires `execute: true` |
| `universa_create_transfer` | Execute a quoted transfer. | Requires `execute: true` |
| `universa_get_transfer` | Read transfer status. | No |

## Environment

```bash
export UNIVERSA_API_BASE_URL="https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api"
export UNIVERSA_API_KEY="..."
export UNIVERSA_API_SECRET="..."
```

Read-only tools still require API credentials when they call Universa. Mutating tools can be previewed without credentials because they default to dry run.

## SDK Usage

```js
import { createUniversaClient } from './agent-toolkit/src/index.mjs'

const universa = createUniversaClient()

const wallet = await universa.getCustomerWallet('cus_...')
console.log(wallet.body.customer_wallet.address)
```

## Agent Tool Usage

```js
import { runUniversaAgentTool } from './agent-toolkit/src/index.mjs'

const draft = await runUniversaAgentTool('universa_prepare_usdc_payout_account', {
  customer_id: 'cus_...',
})

console.log(draft.request)
```

To execute a mutating tool, pass `execute: true`:

```js
await runUniversaAgentTool('universa_prepare_usdc_payout_account', {
  execute: true,
  customer_id: 'cus_...',
  idempotency_key: 'agent:create-va:cus_...:2026-06-15',
})
```

## MCP Server

Run the MCP server over stdio:

```bash
node agent-toolkit/src/mcp-server.mjs
```

Example MCP config:

```json
{
  "mcpServers": {
    "universa": {
      "command": "node",
      "args": ["/Users/exodia/universa/agent-toolkit/src/mcp-server.mjs"],
      "env": {
        "UNIVERSA_API_BASE_URL": "https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api",
        "UNIVERSA_API_KEY": "YOUR_KEY",
        "UNIVERSA_API_SECRET": "YOUR_SECRET"
      }
    }
  }
}
```

## Safety Model

Every mutating tool returns a dry-run request preview unless `execute: true` is explicitly provided. The preview includes the HTTP method, API path, request body, and generated idempotency key so a supervising agent or human can review it before execution.

The toolkit never exports wallet private keys. Wallet export remains behind the existing Universa API and is intentionally not exposed as an agent tool in this first pass.
