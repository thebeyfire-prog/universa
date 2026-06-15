import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token'
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js'
import assert from 'node:assert/strict'
import idl from '../target/idl/kyc_token_vault.json' with { type: 'json' }
import type { KycTokenVault } from '../target/types/kyc_token_vault'

const BN = anchor.BN
const DECIMALS = 6
const MAX_TOTAL_REWARDS = new BN(1_000)

function u64le(value: anchor.BN): Buffer {
  return value.toArrayLike(Buffer, 'le', 8)
}

function pda(programId: PublicKey, seeds: Buffer[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0]
}

async function expectReject(action: Promise<unknown>, label: string): Promise<unknown> {
  try {
    await action
  } catch (error) {
    return error
  }
  assert.fail(`expected ${label} to fail`)
}

function assertAnchorError(error: unknown, code: string): void {
  const text = `${(error as any)?.error?.errorCode?.code ?? ''} ${(error as any)?.message ?? ''}`
  assert.match(text, new RegExp(code, 'i'))
}

async function fundLocalTestWallet(provider: anchor.AnchorProvider, wallet: PublicKey): Promise<void> {
  const balance = await provider.connection.getBalance(wallet)
  if (balance >= LAMPORTS_PER_SOL) return

  const signature = await provider.connection.requestAirdrop(wallet, 10 * LAMPORTS_PER_SOL)
  const latestBlockhash = await provider.connection.getLatestBlockhash()
  await provider.connection.confirmTransaction(
    {
      signature,
      ...latestBlockhash,
    },
    'confirmed',
  )
}

describe('universa developer rewards vault', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const program = new Program<KycTokenVault>(idl as KycTokenVault, provider)
  const payer = (provider.wallet as anchor.Wallet).payer
  const rewardsAuthority = Keypair.generate()
  const attacker = Keypair.generate()
  const developerA = Keypair.generate()
  const developerB = Keypair.generate()

  it('enforces authority, caps, duplicate claims, freezing, and token transfers', async () => {
    await fundLocalTestWallet(provider, payer.publicKey)

    const mint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      DECIMALS,
    )

    const config = pda(program.programId, [Buffer.from('config'), mint.toBuffer()])
    const vaultAuthority = pda(program.programId, [
      Buffer.from('vault_authority'),
      config.toBuffer(),
    ])
    const vault = getAssociatedTokenAddressSync(mint, vaultAuthority, true)

    await program.methods
      .initialize(MAX_TOTAL_REWARDS)
      .accountsStrict({
        admin: payer.publicKey,
        rewardsAuthority: rewardsAuthority.publicKey,
        mint,
        config,
        vaultAuthority,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc()

    await mintTo(
      provider.connection,
      payer,
      mint,
      vault,
      payer,
      BigInt(MAX_TOTAL_REWARDS.toString()),
    )

    const now = Math.floor(Date.now() / 1000)
    const epochId = new BN(202607)
    const epoch = pda(program.programId, [
      Buffer.from('epoch'),
      config.toBuffer(),
      u64le(epochId),
    ])

    const unauthorizedCreate = await expectReject(
      program.methods
        .createEpoch(epochId, new BN(now - 60), new BN(now + 3_600), new BN(700))
        .accountsStrict({
          config,
          rewardsAuthority: attacker.publicKey,
          epoch,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc(),
      'unauthorized epoch creation',
    )
    assertAnchorError(unauthorizedCreate, 'unauthorizedRewardsAuthority')

    await program.methods
      .createEpoch(epochId, new BN(now - 60), new BN(now + 3_600), new BN(700))
      .accountsStrict({
        config,
        rewardsAuthority: rewardsAuthority.publicKey,
        epoch,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rewardsAuthority])
      .rpc()

    let configState = await program.account.config.fetch(config)
    assert.equal(configState.allocatedRewards.toString(), '700')
    assert.equal(configState.totalReleased.toString(), '0')
    assert.equal(configState.epochCount.toString(), '1')

    const developerATokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      developerA.publicKey,
    )
    const claimA = pda(program.programId, [
      Buffer.from('claim'),
      config.toBuffer(),
      epoch.toBuffer(),
      developerA.publicKey.toBuffer(),
    ])

    const unauthorizedRelease = await expectReject(
      program.methods
        .releaseDeveloperReward(new BN(100), new BN(50_000), new BN(300))
        .accountsStrict({
          config,
          mint,
          epoch,
          vault,
          vaultAuthority,
          rewardsAuthority: attacker.publicKey,
          developer: developerA.publicKey,
          claim: claimA,
          developerTokenAccount: developerATokenAccount,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc(),
      'unauthorized reward release',
    )
    assertAnchorError(unauthorizedRelease, 'unauthorizedRewardsAuthority')

    await program.methods
      .releaseDeveloperReward(new BN(100), new BN(50_000), new BN(300))
      .accountsStrict({
        config,
        mint,
        epoch,
        vault,
        vaultAuthority,
        rewardsAuthority: rewardsAuthority.publicKey,
        developer: developerA.publicKey,
        claim: claimA,
        developerTokenAccount: developerATokenAccount,
        payer: payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([rewardsAuthority])
      .rpc()

    const developerABalance = await getAccount(provider.connection, developerATokenAccount)
    assert.equal(developerABalance.amount.toString(), '100')

    const claimAState = await program.account.rewardClaim.fetch(claimA)
    assert.equal(claimAState.amount.toString(), '100')
    assert.equal(claimAState.volumeUsd.toString(), '50000')
    assert.equal(claimAState.feesGenerated.toString(), '300')
    assert.equal(claimAState.developer.toBase58(), developerA.publicKey.toBase58())

    const duplicateClaim = await expectReject(
      program.methods
        .releaseDeveloperReward(new BN(1), new BN(1), new BN(1))
        .accountsStrict({
          config,
          mint,
          epoch,
          vault,
          vaultAuthority,
          rewardsAuthority: rewardsAuthority.publicKey,
          developer: developerA.publicKey,
          claim: claimA,
          developerTokenAccount: developerATokenAccount,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rewardsAuthority])
        .rpc(),
      'duplicate developer claim in same epoch',
    )
    assert.match(String((duplicateClaim as any)?.message ?? duplicateClaim), /already|use|custom|account/i)

    const developerBTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      developerB.publicKey,
    )
    const claimB = pda(program.programId, [
      Buffer.from('claim'),
      config.toBuffer(),
      epoch.toBuffer(),
      developerB.publicKey.toBuffer(),
    ])

    const overEpochCap = await expectReject(
      program.methods
        .releaseDeveloperReward(new BN(601), new BN(1), new BN(1))
        .accountsStrict({
          config,
          mint,
          epoch,
          vault,
          vaultAuthority,
          rewardsAuthority: rewardsAuthority.publicKey,
          developer: developerB.publicKey,
          claim: claimB,
          developerTokenAccount: developerBTokenAccount,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rewardsAuthority])
        .rpc(),
      'epoch cap exceedance',
    )
    assertAnchorError(overEpochCap, 'maxEpochRewardsExceeded')

    await program.methods
      .freezeEpoch()
      .accountsStrict({
        config,
        rewardsAuthority: rewardsAuthority.publicKey,
        epoch,
      })
      .signers([rewardsAuthority])
      .rpc()

    configState = await program.account.config.fetch(config)
    const epochState = await program.account.rewardEpoch.fetch(epoch)
    assert.equal(configState.allocatedRewards.toString(), '100')
    assert.equal(epochState.maxEpochRewards.toString(), '100')
    assert.equal(epochState.releasedAmount.toString(), '100')
    assert.equal(epochState.frozen, true)

    const frozenRelease = await expectReject(
      program.methods
        .releaseDeveloperReward(new BN(1), new BN(1), new BN(1))
        .accountsStrict({
          config,
          mint,
          epoch,
          vault,
          vaultAuthority,
          rewardsAuthority: rewardsAuthority.publicKey,
          developer: developerB.publicKey,
          claim: claimB,
          developerTokenAccount: developerBTokenAccount,
          payer: payer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rewardsAuthority])
        .rpc(),
      'release from frozen epoch',
    )
    assertAnchorError(frozenRelease, 'epochFrozen')

    const epochId2 = new BN(202608)
    const epoch2 = pda(program.programId, [
      Buffer.from('epoch'),
      config.toBuffer(),
      u64le(epochId2),
    ])

    await program.methods
      .createEpoch(epochId2, new BN(now - 60), new BN(now + 3_600), new BN(900))
      .accountsStrict({
        config,
        rewardsAuthority: rewardsAuthority.publicKey,
        epoch: epoch2,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rewardsAuthority])
      .rpc()

    configState = await program.account.config.fetch(config)
    assert.equal(configState.allocatedRewards.toString(), '1000')
    assert.equal(configState.epochCount.toString(), '2')

    const epochId3 = new BN(202609)
    const epoch3 = pda(program.programId, [
      Buffer.from('epoch'),
      config.toBuffer(),
      u64le(epochId3),
    ])
    const overTotalCap = await expectReject(
      program.methods
        .createEpoch(epochId3, new BN(now - 60), new BN(now + 3_600), new BN(1))
        .accountsStrict({
          config,
          rewardsAuthority: rewardsAuthority.publicKey,
          epoch: epoch3,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rewardsAuthority])
        .rpc(),
      'global rewards cap exceedance',
    )
    assertAnchorError(overTotalCap, 'maxTotalRewardsExceeded')
  })
})
