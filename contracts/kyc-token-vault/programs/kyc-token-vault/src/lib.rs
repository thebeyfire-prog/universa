use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("3JSQmmimLR2fNy1wtrk3CAYpaT6uw1erEjBSU3fVEcwg");

#[program]
pub mod kyc_token_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, max_total_rewards: u64) -> Result<()> {
        require!(max_total_rewards > 0, VaultError::InvalidMaxTotalRewards);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.rewards_authority = ctx.accounts.rewards_authority.key();
        config.mint = ctx.accounts.mint.key();
        config.vault = ctx.accounts.vault.key();
        config.vault_authority_bump = ctx.bumps.vault_authority;
        config.max_total_rewards = max_total_rewards;
        config.allocated_rewards = 0;
        config.total_released = 0;
        config.epoch_count = 0;
        config.created_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn create_epoch(
        ctx: Context<CreateEpoch>,
        epoch_id: u64,
        starts_at: i64,
        ends_at: i64,
        max_epoch_rewards: u64,
    ) -> Result<()> {
        require!(max_epoch_rewards > 0, VaultError::InvalidEpochCap);
        require!(starts_at < ends_at, VaultError::InvalidEpochWindow);

        let config_key = ctx.accounts.config.key();
        let config = &mut ctx.accounts.config;

        require_keys_eq!(
            ctx.accounts.rewards_authority.key(),
            config.rewards_authority,
            VaultError::UnauthorizedRewardsAuthority
        );

        let allocated_rewards = config
            .allocated_rewards
            .checked_add(max_epoch_rewards)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            allocated_rewards <= config.max_total_rewards,
            VaultError::MaxTotalRewardsExceeded
        );

        let epoch = &mut ctx.accounts.epoch;
        epoch.config = config_key;
        epoch.epoch_id = epoch_id;
        epoch.starts_at = starts_at;
        epoch.ends_at = ends_at;
        epoch.max_epoch_rewards = max_epoch_rewards;
        epoch.released_amount = 0;
        epoch.claim_count = 0;
        epoch.frozen = false;
        epoch.created_at = Clock::get()?.unix_timestamp;

        config.allocated_rewards = allocated_rewards;
        config.epoch_count = config
            .epoch_count
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;

        Ok(())
    }

    pub fn freeze_epoch(ctx: Context<FreezeEpoch>) -> Result<()> {
        let config = &mut ctx.accounts.config;

        require_keys_eq!(
            ctx.accounts.rewards_authority.key(),
            config.rewards_authority,
            VaultError::UnauthorizedRewardsAuthority
        );

        let epoch = &mut ctx.accounts.epoch;
        require!(!epoch.frozen, VaultError::EpochFrozen);

        let unused_rewards = epoch
            .max_epoch_rewards
            .checked_sub(epoch.released_amount)
            .ok_or(VaultError::MathOverflow)?;
        config.allocated_rewards = config
            .allocated_rewards
            .checked_sub(unused_rewards)
            .ok_or(VaultError::MathOverflow)?;

        epoch.max_epoch_rewards = epoch.released_amount;
        epoch.frozen = true;

        Ok(())
    }

    pub fn release_developer_reward(
        ctx: Context<ReleaseDeveloperReward>,
        amount: u64,
        volume_usd: u64,
        fees_generated: u64,
    ) -> Result<()> {
        require!(amount > 0, VaultError::InvalidRewardAmount);

        let config_key = ctx.accounts.config.key();
        let epoch_key = ctx.accounts.epoch.key();
        let config = &mut ctx.accounts.config;
        let epoch = &mut ctx.accounts.epoch;

        require_keys_eq!(
            ctx.accounts.rewards_authority.key(),
            config.rewards_authority,
            VaultError::UnauthorizedRewardsAuthority
        );
        require!(!epoch.frozen, VaultError::EpochFrozen);

        let total_released = config
            .total_released
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            total_released <= config.max_total_rewards,
            VaultError::MaxTotalRewardsExceeded
        );

        let epoch_released = epoch
            .released_amount
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        require!(
            epoch_released <= epoch.max_epoch_rewards,
            VaultError::MaxEpochRewardsExceeded
        );

        require!(
            ctx.accounts.vault.amount >= amount,
            VaultError::InsufficientVaultBalance
        );

        let claim = &mut ctx.accounts.claim;
        claim.config = config_key;
        claim.epoch = epoch_key;
        claim.epoch_id = epoch.epoch_id;
        claim.developer = ctx.accounts.developer.key();
        claim.developer_token_account = ctx.accounts.developer_token_account.key();
        claim.amount = amount;
        claim.volume_usd = volume_usd;
        claim.fees_generated = fees_generated;
        claim.released_at = Clock::get()?.unix_timestamp;
        claim.release_slot = Clock::get()?.slot;

        let signer_seeds: &[&[u8]] = &[
            b"vault_authority",
            config_key.as_ref(),
            &[config.vault_authority_bump],
        ];
        let signer = &[signer_seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.developer_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        let cpi_ctx =
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        config.total_released = total_released;
        epoch.released_amount = epoch_released;
        epoch.claim_count = epoch
            .claim_count
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: This public key is the backend signer allowed to create epochs and release rewards.
    pub rewards_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config", mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,

    /// CHECK: PDA token authority. It never signs except through program seeds.
    #[account(
        seeds = [b"vault_authority", config.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct CreateEpoch<'info> {
    #[account(
        mut,
        seeds = [b"config", config.mint.as_ref()],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub rewards_authority: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RewardEpoch::INIT_SPACE,
        seeds = [b"epoch", config.key().as_ref(), &epoch_id.to_le_bytes()],
        bump
    )]
    pub epoch: Account<'info, RewardEpoch>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FreezeEpoch<'info> {
    #[account(
        mut,
        seeds = [b"config", config.mint.as_ref()],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub rewards_authority: Signer<'info>,

    #[account(
        mut,
        has_one = config @ VaultError::InvalidEpoch
    )]
    pub epoch: Account<'info, RewardEpoch>,
}

#[derive(Accounts)]
pub struct ReleaseDeveloperReward<'info> {
    #[account(
        mut,
        seeds = [b"config", config.mint.as_ref()],
        bump,
        constraint = config.mint == mint.key() @ VaultError::InvalidMint,
        has_one = vault @ VaultError::InvalidVault
    )]
    pub config: Account<'info, Config>,

    /// CHECK: The config constraint pins this account to the configured mint.
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = config @ VaultError::InvalidEpoch
    )]
    pub epoch: Account<'info, RewardEpoch>,

    #[account(
        mut,
        constraint = vault.mint == config.mint @ VaultError::InvalidVault,
        constraint = vault.owner == vault_authority.key() @ VaultError::InvalidVault
    )]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA token authority. It never signs except through program seeds.
    #[account(
        seeds = [b"vault_authority", config.key().as_ref()],
        bump = config.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub rewards_authority: Signer<'info>,

    /// CHECK: Developer does not need to sign. Backend releases only after off-chain reward checks pass.
    pub developer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + RewardClaim::INIT_SPACE,
        seeds = [b"claim", config.key().as_ref(), epoch.key().as_ref(), developer.key().as_ref()],
        bump
    )]
    pub claim: Account<'info, RewardClaim>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = developer
    )]
    pub developer_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub rewards_authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub vault_authority_bump: u8,
    pub max_total_rewards: u64,
    pub allocated_rewards: u64,
    pub total_released: u64,
    pub epoch_count: u64,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct RewardEpoch {
    pub config: Pubkey,
    pub epoch_id: u64,
    pub starts_at: i64,
    pub ends_at: i64,
    pub max_epoch_rewards: u64,
    pub released_amount: u64,
    pub claim_count: u64,
    pub frozen: bool,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct RewardClaim {
    pub config: Pubkey,
    pub epoch: Pubkey,
    pub epoch_id: u64,
    pub developer: Pubkey,
    pub developer_token_account: Pubkey,
    pub amount: u64,
    pub volume_usd: u64,
    pub fees_generated: u64,
    pub released_at: i64,
    pub release_slot: u64,
}

#[error_code]
pub enum VaultError {
    #[msg("Max total rewards must be greater than zero.")]
    InvalidMaxTotalRewards,
    #[msg("Epoch reward cap must be greater than zero.")]
    InvalidEpochCap,
    #[msg("Epoch start must be before epoch end.")]
    InvalidEpochWindow,
    #[msg("Reward amount must be greater than zero.")]
    InvalidRewardAmount,
    #[msg("Only the configured rewards authority can manage rewards.")]
    UnauthorizedRewardsAuthority,
    #[msg("The vault max total rewards cap would be exceeded.")]
    MaxTotalRewardsExceeded,
    #[msg("The epoch reward cap would be exceeded.")]
    MaxEpochRewardsExceeded,
    #[msg("The reward epoch is frozen.")]
    EpochFrozen,
    #[msg("The vault does not have enough tokens for this claim.")]
    InsufficientVaultBalance,
    #[msg("Invalid mint account.")]
    InvalidMint,
    #[msg("Invalid vault account.")]
    InvalidVault,
    #[msg("Invalid reward epoch account.")]
    InvalidEpoch,
    #[msg("Math overflow.")]
    MathOverflow,
}
