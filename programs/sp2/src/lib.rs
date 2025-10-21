#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod handlers;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use handlers::*;
pub use state::*;

declare_id!("8SfHhHnLEUz4x4BqMWv1994qGHCcMd6afMUd5Y7EtyfL");

#[program]
pub mod sp2 {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn make_offer(

        ctx: Context<MakeOffer>,
        id: u64,
        token_a_offered_amount: u64,
        token_b_wanted_amount: u64,

    ) -> Result<()> {

        make_offer::make_offer(ctx, id, token_a_offered_amount, token_b_wanted_amount)

    }

    pub fn take_offer(ctx: Context<TakeOffer>) -> Result<()> {
        take_offer::take_offer(ctx)
    }

    pub fn refund_offer(ctx: Context<RefundOffer>) -> Result<()> {

        refund_offer::refund_offer(ctx)

    }

}
