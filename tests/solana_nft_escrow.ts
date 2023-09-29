import * as anchor from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import { IDL } from "../target/types/anchor_escrow";
import {
  PublicKey,
  SystemProgram,
  Connection,
  Commitment,
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount
} from "@solana/spl-token";
import { assert } from "chai";

describe("solana_nft_escrow", () => {
  // Use Mainnet-fork for testing
  const commitment: Commitment = "processed"; // processed, confirmed, finalized
  const connection = new Connection("http://localhost:8899", {
    commitment,
    wsEndpoint: "ws://localhost:8900/"
  });
  // const connection = new Connection("https://api.devnet.solana.com", {
  //   commitment,
  //   wsEndpoint: "wss://api.devnet.solana.com/",
  // });

  const options = anchor.AnchorProvider.defaultOptions();
  const wallet = NodeWallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, options);

  anchor.setProvider(provider);

  const programId = "DGEX1Zf94mjrPHNLiutYTdwfdBBvsXk8BBHF2kFeBPyy";
  const program = new anchor.Program(IDL, programId, provider);

  let mintA = null as PublicKey;
  let mintB = null as PublicKey;
  let initializerTokenAccountA = null as PublicKey;
  let initializerTokenAccountB = null as PublicKey;
  let takerTokenAccountA = null as PublicKey;
  let takerTokenAccountB = null as PublicKey;

  const takerAmount = 1000;
  const initializerAmount = 500;

  // Main Roles
  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const initializer = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();

  // Determined Seeds
  const stateSeed = "state";
  const authoritySeed = "authority";

  // Random Seed
  const randomSeed: anchor.BN = new anchor.BN(
    Math.floor(Math.random() * 100000000)
  );

  // Derive PDAs: escrowStateKey, vaultKey, vaultAuthorityKey
  const escrowStateKey = PublicKey.findProgramAddressSync(
    [
      Buffer.from(anchor.utils.bytes.utf8.encode(stateSeed)),
      randomSeed.toArrayLike(Buffer, "le", 8)
    ],
    program.programId
  )[0];

  const vaultAuthorityKey = PublicKey.findProgramAddressSync(
    [Buffer.from(authoritySeed, "utf-8")],
    program.programId
  )[0];
  let vaultKey = null as PublicKey;

  const getBalancePublicKey = async (publicKey: PublicKey) => {
    const balance = await connection.getBalance(new PublicKey(publicKey));
    return balance;
  };

  it("Initialize program state", async () => {
    // 1. Airdrop 1 SOL to payer
    const signature = await provider.connection.requestAirdrop(
      payer.publicKey,
      1000000000
    );
    const latestBlockhash = await connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash
      },
      commitment
    );

    // 2. Fund main roles: initializer and taker
    const fundingTxMessageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: initializer.publicKey,
          lamports: 100000000
        }),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: taker.publicKey,
          lamports: 100000000
        })
      ]
    }).compileToV0Message();
    const fundingTx = new VersionedTransaction(fundingTxMessageV0);
    fundingTx.sign([payer]);

    // console.log(Buffer.from(fundingTx.serialize()).toString("base64"));
    const result = await connection.sendRawTransaction(fundingTx.serialize());
    // console.log(
    //   `https://solana.fm/tx/${result}?cluster=http%253A%252F%252Flocalhost%253A8899%252F`
    // );

    // 3. Create dummy token mints: mintA and mintB
    mintA = await createMint(
      connection,
      payer,
      mintAuthority.publicKey,
      null,
      0
    );
    mintB = await createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      0
    );

    // 4. Create token accounts for dummy token mints and both main roles
    initializerTokenAccountA = await createAccount(
      connection,
      initializer,
      mintA,
      initializer.publicKey
    );
    initializerTokenAccountB = await createAccount(
      connection,
      initializer,
      mintB,
      initializer.publicKey
    );
    takerTokenAccountA = await createAccount(
      connection,
      taker,
      mintA,
      taker.publicKey
    );
    takerTokenAccountB = await createAccount(
      connection,
      taker,
      mintB,
      taker.publicKey
    );

    // 5. Mint dummy tokens to initializerTokenAccountA and takerTokenAccountB
    await mintTo(
      connection,
      initializer,
      mintA,
      initializerTokenAccountA,
      mintAuthority,
      initializerAmount
    );
    await mintTo(
      connection,
      taker,
      mintB,
      takerTokenAccountB,
      mintAuthority,
      takerAmount
    );

    const fetchedInitializerTokenAccountA = await getAccount(
      connection,
      initializerTokenAccountA
    );
    const fetchedTakerTokenAccountB = await getAccount(
      connection,
      takerTokenAccountB
    );
    const fetchedInitializerTokenAccountB = await getAccount(
      connection,
      initializerTokenAccountB
    );
    const fetchedTakerTokenAccountA = await getAccount(
      connection,
      takerTokenAccountA
    );
    // console.log('information of initializerTokenAccountA is ', fetchedInitializerTokenAccountA);
    // console.log('information of takerTokenAccountB is ', fetchedTakerTokenAccountB);

    assert.ok(
      Number(fetchedInitializerTokenAccountA.amount) == initializerAmount
    );
    assert.ok(Number(fetchedInitializerTokenAccountB.amount) == 0);
    assert.ok(Number(fetchedTakerTokenAccountB.amount) == takerAmount);
    assert.ok(Number(fetchedTakerTokenAccountA.amount) == 0);

    assert.ok(
      fetchedInitializerTokenAccountA.owner.equals(initializer.publicKey)
    );
    assert.ok(
      fetchedInitializerTokenAccountB.owner.equals(initializer.publicKey)
    );
    assert.ok(fetchedTakerTokenAccountB.owner.equals(taker.publicKey));
    assert.ok(fetchedTakerTokenAccountA.owner.equals(taker.publicKey));
    // assert.ok(initializer)
  });

  it("Initialize escrow", async () => {
    let initializer_balance_1 = await getBalancePublicKey(
      initializer.publicKey
    );
    let taker_balance_1 = await getBalancePublicKey(taker.publicKey);
    console.log("here is initializer sol(start): ", initializer_balance_1);
    console.log("here is taker sol(start): ", taker_balance_1);
    // console.log('program.account.escrowState is ', program.account.escrowState)
    const _vaultKey = PublicKey.findProgramAddressSync(
      [
        vaultAuthorityKey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        mintA.toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
    vaultKey = _vaultKey;

    let vault_balance_1 = await getBalancePublicKey(vaultKey);
    console.log("!!!important vault sol(start):", vault_balance_1);

    const result = await program.methods
      .initialize(
        randomSeed,
        // new anchor.BN(initializerAmount),
        // new anchor.BN(takerAmount)
        new anchor.BN(20000000),
        new anchor.BN(40000000)
      )
      .accounts({
        initializer: initializer.publicKey,
        takerKey: taker.publicKey,
        vaultAuthority: vaultAuthorityKey,
        vault: vaultKey,
        mint: mintA,
        initializerReceiveMintAccount: mintB,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        escrowState: escrowStateKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([initializer])
      .rpc();
    console.log(
      `https://solana.fm/tx/${result}?cluster=http%253A%252F%252Flocalhost%253A8899%252F`
    );

    let fetchedVault = await getAccount(connection, vaultKey);
    let fetchedEscrowState = await program.account.escrowState.fetch(
      escrowStateKey
    );

    let initializer_balance = await getBalancePublicKey(initializer.publicKey);
    let taker_balance = await getBalancePublicKey(taker.publicKey);
    let vault_balance = await getBalancePublicKey(vaultKey);
    console.log(
      "here is initializer sol(after initialize): ",
      initializer_balance
    );
    console.log("here is taker sol(after initialize): ", taker_balance);
    console.log("!!!important vault sol(after initialize): ", vault_balance);

    // Check that the new owner is the PDA.
    assert.ok(fetchedVault.owner.equals(vaultAuthorityKey));

    // Check that the values in the escrow account match what we expect.
    assert.ok(fetchedEscrowState.initializerKey.equals(initializer.publicKey));
    // assert.ok(
    //   fetchedEscrowState.initializerAmount.toNumber() == 100
    // );
    // assert.ok(fetchedEscrowState.takerAmount.toNumber() == 1000);
    // console.log(fetchedEscrowState.initializerAmount.toNumber());
    assert.ok(
      fetchedEscrowState.initializerDepositTokenAccount.equals(
        initializerTokenAccountA
      )
    );
    assert.ok(
      fetchedEscrowState.initializerReceiveTokenAccount.equals(
        initializerTokenAccountB
      )
    );
    assert.ok(fetchedEscrowState.initializerDepositMintAccount.equals(mintA));
    assert.ok(fetchedEscrowState.initializerReceiveMintAccount.equals(mintB));

    const fetchedInitializerTokenAccountA = await getAccount(
      connection,
      initializerTokenAccountA
    );
    console.log(
      "InitializerTokenAccountA",
      fetchedInitializerTokenAccountA.amount
    );

    const fetchedTakerTokenAccountB = await getAccount(
      connection,
      takerTokenAccountB
    );
    console.log("TakerTokenAccountB", fetchedTakerTokenAccountB.amount);
  });

  it("Exchange escrow state", async () => {
    let initializer_balance_2 = await getBalancePublicKey(
      initializer.publicKey
    );
    let taker_balance_2 = await getBalancePublicKey(taker.publicKey);
    console.log(
      "here is initializer sol(before exchange): ",
      initializer_balance_2
    );
    console.log("here is taker sol(before exchange): ", taker_balance_2);

    console.log("here is vaultkey: ", vaultKey);

    const result = await program.methods
      .exchange()
      .accounts({
        taker: taker.publicKey,
        initializerDepositTokenMint: mintA,
        takerDepositTokenMint: mintB,
        takerDepositTokenAccount: takerTokenAccountB,
        takerReceiveTokenAccount: takerTokenAccountA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        initializer: initializer.publicKey,
        escrowState: escrowStateKey,
        vault: vaultKey,
        vaultAuthority: vaultAuthorityKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([taker])
      .rpc();
    console.log(
      `https://solana.fm/tx/${result}?cluster=http%253A%252F%252Flocalhost%253A8899%252F`
    );
    let initializer_balance_3 = await getBalancePublicKey(
      initializer.publicKey
    );
    let taker_balance_3 = await getBalancePublicKey(taker.publicKey);
    console.log(
      "here is initializer sol(after exchange): ",
      initializer_balance_3
    );
    console.log("here is taker sol(after exchange): ", taker_balance_3);

    let fetchedInitializerTokenAccountA = await getAccount(
      connection,
      initializerTokenAccountA
    );
    let fetchedInitializerTokenAccountB = await getAccount(
      connection,
      initializerTokenAccountB
    );
    let fetchedTakerTokenAccountA = await getAccount(
      connection,
      takerTokenAccountA
    );
    let fetchedTakerTokenAccountB = await getAccount(
      connection,
      takerTokenAccountB
    );

    console.log("----- token amounts -----");
    console.log("TakerTokenAccountA", fetchedTakerTokenAccountA.amount);
    console.log(
      "InitializerTokenAccountA",
      fetchedInitializerTokenAccountA.amount
    );
    console.log(
      "InitializerTokenAccountB",
      fetchedInitializerTokenAccountB.amount
    );
    console.log("TakerTokenAccountB", fetchedTakerTokenAccountB.amount);
  });

  it("Initialize escrow and cancel escrow", async () => {
    // Put back tokens into initializer token A account.
    // await mintTo(
    //   connection,
    //   initializer,
    //   mintA,
    //   initializerTokenAccountA,
    //   mintAuthority,
    //   initializerAmount
    // );
    let initializer_balance_1 = await getBalancePublicKey(
      initializer.publicKey
    );
    let taker_balance_1 = await getBalancePublicKey(taker.publicKey);
    console.log(
      "here is initializer sol(befor second initialize): ",
      initializer_balance_1
    );
    console.log(
      "here is taker sol(befor second initialize): ",
      taker_balance_1
    );

    const initializedTx = await program.methods
      .initialize(randomSeed, new anchor.BN(20000000), new anchor.BN(40000000))
      .accounts({
        initializer: initializer.publicKey,
        takerKey: taker.publicKey,
        vaultAuthority: vaultAuthorityKey,
        vault: vaultKey,
        mint: mintA,
        initializerReceiveMintAccount: mintB,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        escrowState: escrowStateKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([initializer])
      .rpc();
    console.log(
      `https://solana.fm/tx/${initializedTx}?cluster=http%253A%252F%252Flocalhost%253A8899%252F`
    );

    let initializer_balance_2 = await getBalancePublicKey(
      initializer.publicKey
    );
    let taker_balance_2 = await getBalancePublicKey(taker.publicKey);
    console.log(
      "here is initializer sol(after second initialize): ",
      initializer_balance_2
    );
    console.log(
      "here is taker sol(after second initialize): ",
      taker_balance_2
    );

    let fetchedInitializerTokenAccountA_1 = await getAccount(
      connection,
      initializerTokenAccountA
    );
    let fetchedInitializerTokenAccountB_1 = await getAccount(
      connection,
      initializerTokenAccountB
    );
    let fetchedTakerTokenAccountA_1 = await getAccount(
      connection,
      takerTokenAccountA
    );
    let fetchedTakerTokenAccountB_1 = await getAccount(
      connection,
      takerTokenAccountB
    );

    console.log("----- token amounts -----");
    console.log("TakerTokenAccountA", fetchedTakerTokenAccountA_1.amount);
    console.log(
      "InitializerTokenAccountA",
      fetchedInitializerTokenAccountA_1.amount
    );
    console.log(
      "InitializerTokenAccountB",
      fetchedInitializerTokenAccountB_1.amount
    );
    console.log("TakerTokenAccountB", fetchedTakerTokenAccountB_1.amount);

    // Cancel the escrow.
    const canceledTX = await program.methods
      .cancel()
      .accounts({
        initializer: initializer.publicKey,
        mint: mintA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        vault: vaultKey,
        vaultAuthority: vaultAuthorityKey,
        escrowState: escrowStateKey,
        tokenProgram: TOKEN_PROGRAM_ID
      })
      .signers([initializer])
      .rpc();
    console.log(
      `https://solana.fm/tx/${canceledTX}?cluster=http%253A%252F%252Flocalhost%253A8899%252F`
    );
    let initializer_balance_3 = await getBalancePublicKey(
      initializer.publicKey
    );
    let taker_balance_3 = await getBalancePublicKey(taker.publicKey);
    console.log(
      "here is initializer sol(after cancel): ",
      initializer_balance_3
    );
    console.log("here is taker sol(after cancel): ", taker_balance_3);

    let fetchedInitializerTokenAccountA_2 = await getAccount(
      connection,
      initializerTokenAccountA
    );
    let fetchedInitializerTokenAccountB_2 = await getAccount(
      connection,
      initializerTokenAccountB
    );
    let fetchedTakerTokenAccountA_2 = await getAccount(
      connection,
      takerTokenAccountA
    );
    let fetchedTakerTokenAccountB_2 = await getAccount(
      connection,
      takerTokenAccountB
    );

    console.log("----- token amounts -----");
    console.log("TakerTokenAccountA", fetchedTakerTokenAccountA_2.amount);
    console.log(
      "InitializerTokenAccountA",
      fetchedInitializerTokenAccountA_2.amount
    );
    console.log(
      "InitializerTokenAccountB",
      fetchedInitializerTokenAccountB_2.amount
    );
    console.log("TakerTokenAccountB", fetchedTakerTokenAccountB_2.amount);
  });
});
