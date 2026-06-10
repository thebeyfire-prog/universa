# Universa Developer Rewards

Universa rewards are Solana-native. The production design uses an Anchor
program-owned SPL token vault for UNV developer rewards.

## Goals

- Bind rewards to approved businesses, not anonymous wallets.
- Count only completed, non-reversed API volume.
- Keep a hard 50% developer reward pool cap.
- Make every epoch cap and reward release inspectable on Solana.
- Prevent duplicate developer payouts inside the same epoch.
- Remove upgrade authority before claiming immutability in public copy.

## Allocation Design

| Bucket | Amount |
| --- | ---: |
| Public DBC liquidity | 45% |
| Developer rewards vault | 50% |
| Team vesting | 5% |
| Marketing fund | 0% |

The launch plan mints `10,000,000 UNV`. Public DBC liquidity receives
`4,500,000 UNV`. Reserved supply receives `5,500,000 UNV`; from that reserve,
`5,000,000 UNV` funds the Solana developer rewards vault and `500,000 UNV`
goes to team vesting.

The rewards vault initializes with `max_total_rewards = 5,000,000 UNV` in raw
token units. With 6 decimals, that is `5000000000000`.

## Solana Program Model

The Anchor program lives in the GitHub repo under:

```text
contracts/kyc-token-vault
```

Program behavior:

- `initialize` creates the config PDA and vault associated token account.
- `create_epoch` creates a reward epoch with a fixed cap.
- `release_developer_reward` transfers UNV from the vault to a developer wallet.
- `freeze_epoch` closes unused capacity in an epoch and returns it to the
  remaining global reward budget.

The program does not include an admin withdraw, rescue, or mint instruction.
The only token movement is the capped reward release path.

## What Stays Off-Chain

Solana cannot read Universa API usage, provider compliance status, KYB review, fraud signals,
returns, chargebacks, or revenue data. Those checks remain server-side:

1. Tenant completes KYB and risk review.
2. Tenant reward wallet is linked or generated.
3. Transfers settle through the platform API.
4. Allocation worker calculates eligible settled USD volume.
5. Compliance/risk review holds suspicious tenants.
6. Rewards authority signs Solana releases for approved epoch allocations.

## Public Verification

Publish these before claiming the vault is live:

- UNV mint address.
- Anchor program id.
- Config PDA.
- Vault token account.
- Rewards authority public key.
- Epoch accounts and caps.
- Claim accounts.
- Upgrade authority status.

The no-withdraw guarantee is only complete after the deployed program is
immutable. If upgrade authority remains active, the upgrade authority can change
program logic later.

## Launch Checklist

- Independent smart contract audit.
- Multisig or dedicated signer for rewards authority.
- Generate program keypair locally and keep it out of Git.
- Deploy Anchor program to Solana.
- Initialize vault with the UNV mint and max reward cap.
- Transfer `5,000,000 UNV` to the vault token account.
- Create the first reviewed reward epoch.
- Publish verification addresses.
- Remove upgrade authority only after final verification.
