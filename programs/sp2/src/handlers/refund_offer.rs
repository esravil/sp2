use anchor_lang::prelude::*;
use crate::{state::Offer, error::ErrorCode, constants::OFFER_SEED};
use super::shared::{transfer_tokens, close_token_account};
use anchor_spl::{

    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},

};

#[derive(Accounts)]
pub struct RefundOffer<'info> {

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub maker: Signer<'info>,

    pub mint_address_a: InterfaceAccount<'info, Mint>,

    #[account(

        mut,
        associated_token::mint = mint_address_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program,

    )]
    pub maker_token_account_a: InterfaceAccount<'info, TokenAccount>,

    #[account(

        mut,
        close = maker,
        has_one = maker,
        has_one = mint_address_a,
        seeds = [OFFER_SEED, offer.id.to_le_bytes().as_ref()],
        bump = offer.bump,

    )]
    pub offer: Account<'info, Offer>,

    #[account(

        mut,
        associated_token::mint = mint_address_a,
        associated_token::authority = offer,
        associated_token::token_program = token_program,

    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

}

pub fn refund_offer(ctx: Context<RefundOffer>) -> Result<()> {

    let offer_seeds = &[

        OFFER_SEED,
        &ctx.accounts.offer.id.to_le_bytes()[..],
        &[ctx.accounts.offer.bump]

    ];

    let signer_seeds = Some(&offer_seeds[..]);

    transfer_tokens (

        &ctx.accounts.vault, &ctx.accounts.maker_token_account_a,
        &ctx.accounts.vault.amount,
        &ctx.accounts.mint_address_a,
        &ctx.accounts.offer.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,

    ).map_err(|_| ErrorCode::CustomError)?;

    close_token_account(

        &ctx.accounts.vault,
        &ctx.accounts.maker.to_account_info(),
        &ctx.accounts.offer.to_account_info(),
        &ctx.accounts.token_program,
        signer_seeds,

    ).map_err(|_| ErrorCode::CustomError)?;

    Ok(())

}