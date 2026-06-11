# Universa Token Launch

Meteora DBC launcher for the Universa token.

Current intended parameters:

- Name: `Universa`
- Symbol: `UNV`
- Supply: `10,000,000`
- Public DBC float: `4,500,000`
- Reserved allocation: `5,500,000`
- Developer rewards vault: `5,000,000`
- Team vesting: `500,000`
- Quote asset: `USDC`
- Initial market cap: `$5,000`
- Migration market cap: `$100,000`
- Deployer wallet: `.secrets/sol-wallets/wallet-1.json`
- Default artwork: `assets/universa-oil-hands.png`

Dry run with the final oil-hands artwork:

```bash
npm run dry-run -- --quote USDC
```

Dry run with the final logo:

```bash
npm run dry-run -- --quote USDC --image /path/to/final-logo.png
```

Launch only after the final logo dry run succeeds:

```bash
npm run launch -- --quote USDC --yes
```

If metadata has already been pinned separately:

```bash
npm run launch -- --quote USDC --metadata-uri https://ipfs.io/ipfs/... --yes
```

The script writes the latest dry-run or launch record to `.last-dbc-launch.json`.
That file is ignored because it can contain wallet addresses, mints, pool
addresses, and transaction details before public launch.

## Funding the Developer Rewards Vault

After the DBC pool migrates, the reserved allocation can be withdrawn from
Meteora as leftover base tokens. Fund the Anchor rewards vault immediately with:

```bash
npm run fund-vault
```

That command is a dry run. It reads `.last-dbc-launch.json`, derives the Anchor
vault token account from the UNV mint and rewards vault program id, simulates a
single transaction that withdraws DBC leftover tokens and transfers
`5,000,000 UNV` to the vault, then writes `.last-vault-fund.json`.

Send the transaction only after the dry run succeeds:

```bash
npm run fund-vault -- --execute --yes
```

To leave the script running until the pool has migrated and the DBC leftover is
withdrawable:

```bash
npm run fund-vault -- --watch --execute --yes
```

Useful overrides:

```bash
npm run fund-vault -- \
  --pool <dbc-pool> \
  --mint <unv-mint> \
  --amount 5000000 \
  --program-id 8uQrLVdn8geKdBPVJmoNWUyosN7xoQKxzjdWYpvrAZ3H
```

The script requires the signer wallet to be the DBC `leftoverReceiver`. It
transfers to the program-owned SPL token vault account, not directly to the
program id. The Anchor vault must already be initialized.
