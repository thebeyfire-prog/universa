# Meteora DBC Launch Plan

This repo includes a dry-run planner for launching UNV through Meteora Dynamic
Bonding Curve (DBC) on Solana.

Run:

```bash
npm --prefix launch/meteora-dbc install
npm run dbc:plan
```

The script writes:

```text
launch/meteora-dbc/out/universa-dbc-plan.json
```

## Default Assumptions

- Quote token: USDC
- Total token supply: 10,000,000 UNV
- DBC public float: 4,500,000 UNV
- DBC reserved allocation: 5,500,000 UNV
- Developer rewards vault: 5,000,000 UNV
- Team vesting: 500,000 UNV
- Initial market cap: $5,000
- Migration market cap: $100,000
- Token decimals: 6
- Quote decimals: 6
- Pre-graduation fee: linear scheduler from 100 bps to 25 bps
- Migration: Meteora DAMM v2
- LP distribution: 100% partner permanently locked
- Pool creation fee: 0.001 quote token

Override defaults with env vars:

```bash
UNIVERSA_DBC_PUBLIC_FLOAT_SUPPLY=4500000 \
UNIVERSA_DBC_INITIAL_MARKET_CAP=5000 \
UNIVERSA_DBC_MIGRATION_MARKET_CAP=100000 \
UNIVERSA_DBC_FIRST_BUY_QUOTE_AMOUNT=500 \
npm run dbc:plan
```

## Public Float Math

Universa's reserve model is handled before launch:

| Bucket | Amount |
| --- | ---: |
| DBC public float | 45% |
| Developer rewards vault | 50% |
| Team vesting | 5% |
| Marketing fund | 0% |

Meteora DBC creates the token mint during pool initialization. For a single UNV
mint, the config should use the full supply as `totalTokenSupply` and reserve
the non-public allocation as `leftover`.

Practically:

1. Generate the UNV `baseMint` keypair locally.
2. Build the DBC config with `totalTokenSupply = 10_000_000` and
   `leftover = 5_500_000`.
3. Call the DBC pool creation instruction with that `baseMint`.
4. DBC initializes the mint and pool in the launch transaction.
5. After migration, call `withdrawLeftover`; the reserved supply goes to the
   configured `leftoverReceiver`.
6. From the leftover receiver, fund the Solana Anchor developer rewards vault
   with `5,000,000 UNV` and lock/vest `500,000 UNV` for team.

At a fixed $5,000 market cap and 10,000,000 total supply:

```text
initial token price = 5000 / 10,000,000 = $0.0005
500 / 0.0005 = 1,000,000 tokens
```

That is fixed-price math only. DBC is a bonding curve, so a buy moves the price
along the curve and should cost more than fixed-price math before fees and
slippage.

## Execution Checklist

- Decide final USDC mainnet quote mint.
- Decide final migration market cap.
- Confirm leftover receiver multisig and reserved allocation transactions.
- Confirm DBC public float supply.
- Upload immutable metadata JSON and image.
- Choose payer, fee claimer, leftover receiver, and pool creator wallets.
- Generate and review the DBC plan JSON.
- Simulate before signing.
- Deploy and initialize the Solana Anchor rewards vault separately.
