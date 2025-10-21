use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Offer {

    pub id: u64,
    pub maker: Pubkey,
    pub mint_address_a: Pubkey,
    pub mint_address_b: Pubkey,
    pub mint_address_b_wanted: u64,
    pub bump: u8,

}