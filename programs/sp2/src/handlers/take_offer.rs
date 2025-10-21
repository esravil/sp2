use anchor_lang::prelude::*;
use crate::{state::Offer, error::ErrorCode, constants::OFFER_SEED};
use super::shared::{transfer_tokens, close_token_account};
use anchor_spl::{

    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},

};

#[derive(Accounts)]
pub struct TakeOffer<'info> {

    
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub taker: Signer<'info>,

    #[account(mut)]
    pub maker: SystemAccount<'info>,

    pub mint_address_a: InterfaceAccount<'info, Mint>,
    pub mint_address_b: InterfaceAccount<'info, Mint>,

    #[account(

        init_if_needed,
        payer = taker,
        associated_token::mint = mint_address_a,
        associated_token::authority = taker,
        associated_token::token_program = token_program,

    )]
    pub taker_token_account_a: InterfaceAccount<'info, TokenAccount>,

    #[account(

        mut,
        associated_token::mint = mint_address_b,
        associated_token::authority = taker,
        associated_token::token_program = token_program,

    )]
    pub taker_token_account_b: InterfaceAccount<'info, TokenAccount>,

    #[account(

        init_if_needed,
        payer = taker,
        associated_token::mint = mint_address_b,
        associated_token::authority = maker,
        associated_token::token_program = token_program,

    )]
    pub maker_token_account_b: InterfaceAccount<'info, TokenAccount>,

    #[account(

        mut,
        close = taker,
        has_one = maker,
        has_one = mint_address_b,
        seeds = [OFFER_SEED, offer.id.to_le_bytes().as_ref()],
        bump = offer.bump

    )]
    pub offer: Account<'info, Offer>,

    #[account(

        mut,
        associated_token::mint = mint_address_a,
        associated_token::authority = offer,
        associated_token::token_program = token_program

    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

}

pub fn take_offer(ctx: Context<TakeOffer>) -> Result<()> {

    let offer_seeds = &[

        OFFER_SEED,
        &ctx.accounts.offer.id.to_le_bytes()[..],
        &[ctx.accounts.offer.bump],

    ];

    let signer_seeds = Some(&offer_seeds[..]);

    transfer_tokens (

        &ctx.accounts.vault,
        &ctx.accounts.taker_token_account_a,
        &ctx.accounts.vault.amount,
        &ctx.accounts.mint_address_a,
        &ctx.accounts.offer.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,

    ).map_err(|_| ErrorCode::CustomError)?;

    close_token_account (

        &ctx.accounts.vault,
        &ctx.accounts.maker.to_account_info(),
        &ctx.accounts.offer.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,

    ).map_err(|_| ErrorCode::CustomError)?;

    transfer_tokens (

        &ctx.accounts.taker_token_account_b,
        &ctx.accounts.maker_token_account_b,
        &ctx.accounts.offer.mint_address_b_wanted,
        &ctx.accounts.mint_address_b,
        &ctx.accounts.taker.to_account_info(),
        &ctx.accounts.token_program,
        None,

    ).map_err(|_| ErrorCode::CustomError)?;

    Ok(())

}