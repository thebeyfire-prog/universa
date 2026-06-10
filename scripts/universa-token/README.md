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
