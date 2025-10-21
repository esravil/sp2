// tests/sp2.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Address, Lamports, Signature } from "@solana/kit";
import {
  connect,
  SOL,
  ASSOCIATED_TOKEN_PROGRAM,
  TOKEN_PROGRAM,
  type Connection,
} from "solana-kite";
import {
  AccountRole,
  type AccountMeta,
  type Instruction,
} from "@solana/kit";

// ---- generated client (CJS/ESM safe) ----
import * as sp2Ns from "../app/src/clients/generated/index.ts";
const sp2 = (sp2Ns as any).default ?? sp2Ns;

// ------------------ Helpers ------------------

// Helper to brand bigint -> Lamports for kite/@solana/kit
const lamports = (v: bigint) => v as unknown as Lamports;

// u64 -> 8-byte little-endian
const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  let x = n;
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-bitwise
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
};

/** Associated Token Program: CreateIdempotent (opcode = 1) */
function buildCreateAtaIdempotentIx(params: {
  payer: Address;
  owner: Address;
  mint: Address;
  ata: Address;
}): Instruction {
  const { payer, owner, mint, ata } = params;
  const accounts: AccountMeta[] = [
    { address: payer, role: AccountRole.WRITABLE_SIGNER }, // payer (signer)
    { address: ata, role: AccountRole.WRITABLE }, // ATA to (create-if-needed)
    { address: owner, role: AccountRole.READONLY }, // token owner
    { address: mint, role: AccountRole.READONLY }, // mint
    {
      address:
        "11111111111111111111111111111111" as Address<"11111111111111111111111111111111">,
      role: AccountRole.READONLY,
    }, // System Program
    { address: TOKEN_PROGRAM, role: AccountRole.READONLY }, // SPL Token (classic)
  ];
  // data: single byte 1 = CreateIdempotent
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    accounts,
    data: Uint8Array.of(1),
  };
}

/** SPL-Token (classic Tokenkeg) MintTo (opcode = 7) */
function buildMintToIx(params: {
  mint: Address;
  destination: Address;
  mintAuthority: Address;
  amount: bigint;
}): Instruction {
  const { mint, destination, mintAuthority, amount } = params;
  const accounts: AccountMeta[] = [
    { address: mint, role: AccountRole.WRITABLE }, // Mint
    { address: destination, role: AccountRole.WRITABLE }, // Destination token account
    { address: mintAuthority, role: AccountRole.READONLY_SIGNER }, // Mint authority
  ];
  const data = new Uint8Array(1 + 8);
  data[0] = 7; // MintTo
  data.set(u64le(amount), 1);
  return { programAddress: TOKEN_PROGRAM, accounts, data };
}

// ------------------ Test ------------------

describe("make + take + refund (kit-only, ATA-safe mint)", () => {
  let connection: Connection;

  it("initializes connection", () => {
    connection = connect(process.env.SOLANA_CLUSTER ?? "localnet");
    assert.ok(connection.rpc, "connection.rpc should be available");
  });

  it("creates offer pda + ata vault for mint A",
    async () => {
      // 1) Maker wallet + ensure funds
      const maker = await connection.createWallet();
      await connection.airdropIfRequired(
        maker.address,
        lamports(2n * SOL),
        lamports(1n * SOL)
      );

      // 2) Two mints: A (offered), B (wanted) — classic Token (no extensions)
      const decimals = 6;
      const mintA = await connection.createTokenMint({
        mintAuthority: maker,
        decimals,
        useTokenExtensions: false,
      });

      const mintAInfo = await connection.rpc
        .getAccountInfo(mintA, { encoding: "base64" } as any)
        .send();
      console.log("mintA program owner:", mintAInfo.value?.owner); // should be Tokenkeg...

      const mintB = await connection.createTokenMint({
        mintAuthority: maker,
        decimals,
        useTokenExtensions: false,
      });

      // 3) Ensure maker’s ATA for A exists (IDEMPOTENT), then mint to it explicitly
      const makerAtaA = await connection.getTokenAccountAddress(
        maker.address,
        mintA,
        /* useTokenExtensions */ false
      );

      // Create ATA idempotently (safe on reruns)
      {
        const ix = buildCreateAtaIdempotentIx({
          payer: maker.address,
          owner: maker.address,
          mint: mintA as Address,
          ata: makerAtaA as Address,
        });
        const sig = await connection.sendTransactionFromInstructions({
          feePayer: maker,
          instructions: [ix],
          commitment: "confirmed",
        });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      }

      // Sanity: balance before mint should be zero
      const pre0 = await connection.getTokenAccountBalance({
        tokenAccount: makerAtaA,
      });
      console.log(
        "maker ATA balance before mint:",
        pre0.amount,
        "decimals:",
        pre0.decimals
      );
      if (pre0.amount !== 0n) throw new Error(`new ATA not zero: ${pre0.amount}`);

      // 4) Mint to THAT exact ATA (no helper that might choose differently)
      const tokenAOfferedAmount = 1_000_000n; // 1.0 A @ 6 dp
      {
        const mintToIx = buildMintToIx({
          mint: mintA as Address,
          destination: makerAtaA as Address,
          mintAuthority: maker.address as Address, // mint authority is maker
          amount: tokenAOfferedAmount,
        });
        const sig = await connection.sendTransactionFromInstructions({
          feePayer: maker,
          instructions: [mintToIx],
          commitment: "confirmed",
        });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      }

      // Confirm maker ATA received the mint
      const postMint = await connection.getTokenAccountBalance({
        tokenAccount: makerAtaA,
      });
      console.log("maker ATA balance after mint:", postMint.amount);
      assert.equal(postMint.amount, tokenAOfferedAmount);

      // 5) Build make_offer via generated client
      const id = 42n;
      const tokenBWantedAmount = 2_500_000n; // 2.5 B

      // Derive PDA and expected vault ATA = ATA(offerPda, mintA)
      const { pda: offerPda } = await connection.getPDAAndBump(
        sp2.SP2_PROGRAM_ADDRESS,
        ["offer", id]
      );
      const vaultAta = await connection.getTokenAccountAddress(
        offerPda,
        mintA,
        /* useTokenExtensions */ false
      );

      // Instruction (Anchor client)
      const makeOfferIx = await sp2.getMakeOfferInstructionAsync({
        maker,
        mintAddressA: mintA as Address,
        mintAddressB: mintB as Address,
        makerTokenAccountA: makerAtaA as Address, // exact ATA we minted to
        offer: offerPda as Address, // PDA derived identically to program
        vault: vaultAta as Address, // ATA(offerPda, mintA)
        id,
        tokenAOfferedAmount,
        tokenBWantedAmount,
      });

      // 6) Send + confirm make_offer
      {
        const sig = await connection.sendTransactionFromInstructions({
          feePayer: maker,
          instructions: [makeOfferIx as any],
          commitment: "confirmed",
        });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      }

      // 7) Assert Offer data
      const offerAcc = await sp2.fetchOffer(connection.rpc, offerPda);
      assert.equal(offerAcc.data.id, id);
      assert.equal(offerAcc.data.maker.toString(), maker.address.toString());
      assert.equal(offerAcc.data.mintAddressA.toString(), mintA as string);
      assert.equal(offerAcc.data.mintAddressB.toString(), mintB as string);
      assert.equal(offerAcc.data.mintAddressBWanted, tokenBWantedAmount);
      assert.equal(typeof offerAcc.data.bump, "number");

      // 8) Assert token movement: maker -> vault
      const vaultBal = await connection.getTokenAccountBalance({
        tokenAccount: vaultAta,
      });
      assert.equal(vaultBal.amount, tokenAOfferedAmount);

      const makerBal = await connection.getTokenAccountBalance({
        tokenAccount: makerAtaA,
      });
      assert.equal(makerBal.amount, 0n);
    }
  );

  it("takes an offer: vault A -> taker; taker B -> maker token acc b; vault & offer close",
    async () => {
      // actors
      const maker = await connection.createWallet();
      const taker = await connection.createWallet();
      await connection.airdropIfRequired(maker.address, lamports(2n * SOL), lamports(1n * SOL));
      await connection.airdropIfRequired(taker.address, lamports(2n * SOL), lamports(1n * SOL));

      // mints
      const decimals = 6;
      const mintA = await connection.createTokenMint({ mintAuthority: maker, decimals, useTokenExtensions: false });
      const mintB = await connection.createTokenMint({ mintAuthority: maker, decimals, useTokenExtensions: false });

      // maker ATA(A) + mint A to it
      const makerAtaA = await connection.getTokenAccountAddress(maker.address, mintA, false);
      {
        const ix = buildCreateAtaIdempotentIx({ payer: maker.address, owner: maker.address, mint: mintA as Address, ata: makerAtaA as Address });
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [ix] });
        await connection.getRecentSignatureConfirmation({ signature: sig as unknown as Signature, commitment: "confirmed", abortSignal: new AbortController().signal });
      }
      const tokenAOfferedAmount = 1_000_000n;
      {
        const ix = buildMintToIx({ mint: mintA as Address, destination: makerAtaA as Address, mintAuthority: maker.address as Address, amount: tokenAOfferedAmount });
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [ix] });
        await connection.getRecentSignatureConfirmation({ signature: sig as unknown as Signature, commitment: "confirmed", abortSignal: new AbortController().signal });
      }

      // taker ATA(B) + mint B to it
      const takerAtaB = await connection.getTokenAccountAddress(taker.address, mintB, false);
      {
        const ix = buildCreateAtaIdempotentIx({ payer: taker.address, owner: taker.address, mint: mintB as Address, ata: takerAtaB as Address });
        const sig = await connection.sendTransactionFromInstructions({ feePayer: taker, instructions: [ix] });
        await connection.getRecentSignatureConfirmation({ signature: sig as unknown as Signature, commitment: "confirmed", abortSignal: new AbortController().signal });
      }
      const tokenBWantedAmount = 2_500_000n;
      {
        const ix = buildMintToIx({ mint: mintB as Address, destination: takerAtaB as Address, mintAuthority: maker.address as Address, amount: tokenBWantedAmount });
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [ix] });
        await connection.getRecentSignatureConfirmation({ signature: sig as unknown as Signature, commitment: "confirmed", abortSignal: new AbortController().signal });
      }

      // create offer (moves A -> vault)
      const id = 100n;
      const { pda: offerPda } = await connection.getPDAAndBump(sp2.SP2_PROGRAM_ADDRESS, ["offer", id]);
      const vaultAta = await connection.getTokenAccountAddress(offerPda, mintA, false);

      const makeOfferIx = await (sp2 as any).getMakeOfferInstructionAsync({
        maker,
        mintAddressA: mintA as Address,
        mintAddressB: mintB as Address,
        makerTokenAccountA: makerAtaA as Address,
        offer: offerPda as Address,
        vault: vaultAta as Address,
        id,
        tokenAOfferedAmount,
        tokenBWantedAmount,
      });
      {
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [makeOfferIx as any] });
        await connection.getRecentSignatureConfirmation({ signature: sig as unknown as Signature, commitment: "confirmed", abortSignal: new AbortController().signal });
      }

      const vaultPre = await connection.getTokenAccountBalance({ tokenAccount: vaultAta });
      assert.equal(vaultPre.amount, tokenAOfferedAmount);

      // Read back the offer and LOG id + bump (these are the seeds Anchor will use)
      const onchainOffer = await (sp2 as any).fetchOffer(connection.rpc, offerPda);
      console.log("offer on-chain id:", onchainOffer.data.id.toString(), "bump:", onchainOffer.data.bump);

      // Sanity: Offer PDA must be PDA("offer", id) — little-endian u64
      {
        const { pda: expectOffer } = await connection.getPDAAndBump(sp2.SP2_PROGRAM_ADDRESS, ["offer", id]);
        console.log("expectOffer:", expectOffer.toString());
        console.log("offerPda   :", offerPda.toString());
        if (expectOffer.toString() !== offerPda.toString()) {
          throw new Error(`offer PDA mismatch: expected ${expectOffer}, got ${offerPda}`);
        }
      }

      // Sanity: Vault must be ATA(offer, mintA, TOKEN_PROGRAM)
      {
        const expectVault = await connection.getTokenAccountAddress(offerPda, mintA, false);
        console.log("expectVault:", expectVault.toString());
        console.log("vaultAta   :", vaultAta.toString());
        if (expectVault.toString() !== vaultAta.toString()) {
          throw new Error(`vault ATA mismatch: expected ${expectVault}, got ${vaultAta}`);
        }
      }

      // take offer (use generated client; taker signs)
      const takerAtaA = await connection.getTokenAccountAddress(taker.address, mintA, false);
      const makerAtaB = await connection.getTokenAccountAddress(maker.address, mintB, false);

      const takeOfferIx = await (sp2 as any).getTakeOfferInstructionAsync({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: "11111111111111111111111111111111" as Address<"11111111111111111111111111111111">,
        taker,
        maker: maker.address as Address,
        mintAddressA: mintA as Address,
        mintAddressB: mintB as Address,
        takerTokenAccountA: takerAtaA as Address,
        takerTokenAccountB: takerAtaB as Address,
        makerTokenAccountB: makerAtaB as Address,   // program should declare authority = maker
        offer: offerPda as Address,
        vault: vaultAta as Address,
      });

      let sig: Signature | null = null;
      try {
        sig = await connection.sendTransactionFromInstructions({ feePayer: taker, instructions: [takeOfferIx as any] });
        await connection.getRecentSignatureConfirmation({ signature: sig as unknown as Signature, commitment: "confirmed", abortSignal: new AbortController().signal });
      } catch (e) {
        if (sig) {
          const logs = await connection.getLogs(sig as unknown as string);
          console.log("take_offer logs:");
          for (const l of logs) console.log(l);
        }
        throw e;
      }

      // assertions
      const takerABal = await connection.getTokenAccountBalance({ tokenAccount: takerAtaA });
      assert.equal(takerABal.amount, tokenAOfferedAmount);
      const makerBBal = await connection.getTokenAccountBalance({ tokenAccount: makerAtaB });
      assert.equal(makerBBal.amount, tokenBWantedAmount);

      const vaultClosed = await connection.checkTokenAccountIsClosed({ tokenAccount: vaultAta });
      assert.equal(vaultClosed, true);
      const offerInfo = await connection.rpc.getAccountInfo(offerPda, { encoding: "base64" } as any).send();
      assert.equal(offerInfo.value, null);
    }
  );

  it("refunds an offer: vault A -> maker; close vault & offer",
    async () => {
      // actors
      const maker = await connection.createWallet();
      await connection.airdropIfRequired(maker.address, lamports(2n * SOL), lamports(1n * SOL));

      // mints
      const decimals = 6;
      const mintA = await connection.createTokenMint({
        mintAuthority: maker,
        decimals,
        useTokenExtensions: false,
      });
      const mintB = await connection.createTokenMint({
        mintAuthority: maker,
        decimals,
        useTokenExtensions: false,
      });

      // maker ATA(A) + mint A to it
      const makerAtaA = await connection.getTokenAccountAddress(maker.address, mintA, false);
      {
        const ix = buildCreateAtaIdempotentIx({
          payer: maker.address,
          owner: maker.address,
          mint: mintA as Address,
          ata: makerAtaA as Address,
        });
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [ix] });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      }
      const tokenAOfferedAmount = 1_000_000n; // 1.0 A
      {
        const ix = buildMintToIx({
          mint: mintA as Address,
          destination: makerAtaA as Address,
          mintAuthority: maker.address as Address,
          amount: tokenAOfferedAmount,
        });
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [ix] });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      }

      // create offer (moves A -> vault)
      const id = 777n;
      const { pda: offerPda } = await connection.getPDAAndBump(sp2.SP2_PROGRAM_ADDRESS, ["offer", id]);
      const vaultAta = await connection.getTokenAccountAddress(offerPda, mintA, false);

      const tokenBWantedAmount = 2_500_000n; // arbitrary; unused in refund path
      const makeOfferIx = await (sp2 as any).getMakeOfferInstructionAsync({
        maker,
        mintAddressA: mintA as Address,
        mintAddressB: mintB as Address,
        makerTokenAccountA: makerAtaA as Address,
        offer: offerPda as Address,
        vault: vaultAta as Address,
        id,
        tokenAOfferedAmount,
        tokenBWantedAmount,
      });
      {
        const sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [makeOfferIx as any] });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      }

      // Sanity: Offer + vault look right
      const offerAcc = await (sp2 as any).fetchOffer(connection.rpc, offerPda);
      console.log("refund test — offer id:", offerAcc.data.id.toString(), "bump:", offerAcc.data.bump);
      {
        const { pda: expectOffer } = await connection.getPDAAndBump(sp2.SP2_PROGRAM_ADDRESS, ["offer", id]);
        if (expectOffer.toString() !== offerPda.toString()) {
          throw new Error(`offer PDA mismatch: expected ${expectOffer}, got ${offerPda}`);
        }
      }
      {
        const expectVault = await connection.getTokenAccountAddress(offerPda, mintA, false);
        if (expectVault.toString() !== vaultAta.toString()) {
          throw new Error(`vault ATA mismatch: expected ${expectVault}, got ${vaultAta}`);
        }
      }

      const vaultPre = await connection.getTokenAccountBalance({ tokenAccount: vaultAta });
      assert.equal(vaultPre.amount, tokenAOfferedAmount);
      const makerPreA = await connection.getTokenAccountBalance({ tokenAccount: makerAtaA });
      assert.equal(makerPreA.amount, 0n); // already moved to vault by make_offer

      // REFUND — maker signs
      const refundIx = await (sp2 as any).getRefundOfferInstructionAsync({
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
        tokenProgram: TOKEN_PROGRAM,
        systemProgram: "11111111111111111111111111111111" as Address<"11111111111111111111111111111111">,
        maker,
        mintAddressA: mintA as Address,
        makerTokenAccountA: makerAtaA as Address,
        offer: offerPda as Address,
        vault: vaultAta as Address,
      });

      let sig: Signature | null = null;
      try {
        sig = await connection.sendTransactionFromInstructions({ feePayer: maker, instructions: [refundIx as any] });
        await connection.getRecentSignatureConfirmation({
          signature: sig as unknown as Signature,
          commitment: "confirmed",
          abortSignal: new AbortController().signal,
        });
      } catch (e) {
        if (sig) {
          const logs = await connection.getLogs(sig as unknown as string);
          console.log("refund_offer logs:");
          for (const l of logs) console.log(l);
        }
        throw e;
      }

      // assertions — A is back to maker, vault & offer closed
      const makerPostA = await connection.getTokenAccountBalance({ tokenAccount: makerAtaA });
      assert.equal(makerPostA.amount, tokenAOfferedAmount);

      const vaultClosed = await connection.checkTokenAccountIsClosed({ tokenAccount: vaultAta });
      assert.equal(vaultClosed, true);

      const offerInfo = await connection.rpc.getAccountInfo(offerPda, { encoding: "base64" } as any).send();
      assert.equal(offerInfo.value, null);
    }
  );

});
