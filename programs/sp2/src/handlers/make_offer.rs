use anchor_lang::prelude::*;
use crate::{state::Offer, error::ErrorCode, constants::OFFER_SEED};
use super::shared::transfer_tokens;
use anchor_spl::{

    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},

};

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct MakeOffer<'info> {

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,

    #[account(mut)]
    pub maker: Signer<'info>, // signer because they sign tx from maker token acc a -> PDA owned token a vault

    #[account(

        mint::token_program = token_program,

    )]
    pub mint_address_a: InterfaceAccount<'info, Mint>,

    #[account(

        mint::token_program = token_program,

    )]
    pub mint_address_b: InterfaceAccount<'info, Mint>,

    #[account(

        mut,
        associated_token::mint = mint_address_a,
        associated_token::authority = maker,
        associated_token::token_program = token_program,

    )]
    pub maker_token_account_a: InterfaceAccount<'info, TokenAccount>,

    #[account(

        init,
        payer = maker,
        space = Offer::DISCRIMINATOR.len() + Offer::INIT_SPACE,
        seeds = [OFFER_SEED, id.to_le_bytes().as_ref()],
        bump,

    )]
    pub offer: Account<'info, Offer>,

    #[account(

        init, // need to init vault as well
        payer = maker,
        associated_token::mint = mint_address_a,
        associated_token::authority = offer,
        associated_token::token_program = token_program,

    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,

}

pub fn make_offer(

    ctx: Context<MakeOffer>,
    id: u64,
    token_a_offered_amount: u64,
    token_b_wanted_amount: u64,

) -> Result<()> {

    require!(token_a_offered_amount > 0, ErrorCode::CustomError);
    require!(token_b_wanted_amount > 0, ErrorCode::CustomError);

    require!(&ctx.accounts.mint_address_a.key() != &ctx.accounts.mint_address_b.key(), ErrorCode::CustomError);

    transfer_tokens (

        &ctx.accounts.maker_token_account_a,
        &ctx.accounts.vault,
        &token_a_offered_amount,
        &ctx.accounts.mint_address_a,
        &ctx.accounts.maker.to_account_info(),
        &ctx.accounts.token_program,
        None,

    ).map_err( |_| ErrorCode::CustomError)?;

    ctx.accounts.offer.set_inner(

        Offer {

            id,
            maker: ctx.accounts.maker.key(),
            mint_address_a: ctx.accounts.mint_address_a.key(),
            mint_address_b: ctx.accounts.mint_address_b.key(),
            mint_address_b_wanted: token_b_wanted_amount,
            bump: ctx.bumps.offer,

        }

    );

    Ok(())

}