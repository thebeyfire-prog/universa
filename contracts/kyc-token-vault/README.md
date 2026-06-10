# Universa Developer Rewards Vault

Immutable Solana vault for UNV developer rewards.

## What It Enforces

- UNV tokens sit in a program-owned SPL token vault.
- There is no admin withdraw, rescue, or owner-controlled token movement.
- The only token movement is `release_developer_reward`.
- Each developer wallet can receive at most one reward per epoch.
- Each release requires the configured `rewards_authority` signer.
- Each epoch has a fixed reward cap.
- The whole vault has a fixed lifetime reward cap.
- Epochs can be frozen to stop future payouts from that epoch; unused epoch cap is returned to the global allocation budget for later epochs.

This means once the developer rewards allocation is transferred into the vault, anyone can verify on-chain that the team cannot pull it back. Rewards can only leave through capped epoch releases.

## What It Cannot Know On-Chain

Solana cannot read Universa API usage, provider KYC/KYB status, Supabase rows, fraud signals, chargebacks, or revenue data. Those checks must happen off-chain.

The intended flow is:

1. Developer signs up and passes the required compliance/risk checks.
2. Universa tracks real API volume, fees generated, customer quality, failed transfers, and abuse flags.
3. Backend computes an epoch reward amount.
4. Backend signs `release_developer_reward` with the `rewards_authority` key.
5. The claim PDA prevents the same developer wallet from receiving twice for the same epoch.

Public verification remains straightforward: people can inspect the config, vault token account, epoch accounts, and reward claim accounts to see caps, released amounts, developer wallet, raw token amount, volume metadata, fee metadata, timestamp, and release slot.

## Relaunch Target

Recommended UNV relaunch allocation:

- Total supply: `10,000,000 UNV`
- Public / DBC liquidity: `4,500,000 UNV`
- Developer rewards vault: `5,000,000 UNV`
- Team vesting: `500,000 UNV`
- Marketing fund: `0 UNV`

The developer rewards vault should initialize with:

- UNV mint: new relaunched mint
- UNV decimals: `6`
- Vault allocation: `5,000,000 UNV`
- Raw `max_total_rewards`: `5000000000000`

Epoch caps should be created monthly or quarterly. Example:

- `epoch_id`: `202607`
- `starts_at`: Unix timestamp for July 1, 2026
- `ends_at`: Unix timestamp for August 1, 2026
- `max_epoch_rewards`: raw UNV cap for that month

## Deployment Notes

Current generated program id: `3JSQmmimLR2fNy1wtrk3CAYpaT6uw1erEjBSU3fVEcwg`.

1. Generate the program keypair locally and keep it out of Git.
2. Confirm `Anchor.toml` and `declare_id!` match the generated public program id.
3. Run `anchor build`.
4. Run `anchor deploy --provider.cluster mainnet`.
5. Initialize with:
   - UNV mint
   - rewards authority public key
   - max total rewards in raw token units: `5000000000000`
6. Transfer the 50% UNV developer rewards allocation to the generated vault token account.
7. Create reward epochs with explicit caps.
8. After final verification, make the program immutable by removing upgrade authority.
9. Publish the program id, config PDA, vault token account, epoch accounts, upgrade-authority status, and relaunched mint.

The `rewards_authority` private key must never live in the app. It should be held by the backend or a dedicated signer service.

The no-withdraw guarantee is only complete if the deployed Solana program is immutable. If upgrade authority remains active, the upgrade authority could deploy new logic later.

Generated Anchor files under `target/` are intentionally ignored. Do not publish
program keypairs, deployer wallets, rewards authority keys, or launch records.
If a keypair has ever been committed or printed in logs, rotate it before any
mainnet deployment.
