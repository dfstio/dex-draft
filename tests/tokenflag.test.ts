import { describe, expect, it } from "@jest/globals";
import {
  Bool,
  Field,
  PrivateKey,
  SmartContract,
  State,
  method,
  state,
  Mina,
  AccountUpdate,
  Cache,
  PublicKey,
  UInt8,
} from "o1js";
import { FungibleToken } from "../src/FungibleToken";
import { FungibleTokenAdmin } from "../src/FungibleTokenAdmin";

/**
 * Amended from https://github.com/o1-labs/o1js/blob/main/src/examples/zkapps/joint-update.ts by
 * deploying the A and B contracts to token accounts and adding a test case.
 *
 * This is an example for two zkapps that are guaranteed to update their states _together_.
 *
 * So, A's state will updated if and only if B's state is updated, and vice versa.
 *
 * The difficulty here is that, while zkApps know and prove which other zkApps they call themselves,
 * there's nothing in the protocol that lets them know which other zkApps are calling _them_.
 *
 * In other words, while one-way interactions are easy to implement, two-way interactions require additional tricks.
 *
 * This example is supposed to give you an idea for how to implement two-way interactions.
 *
 * The idea is that the user calls B, which calls A, so B knows it's jointly updating with A.
 * In addition, B sets a flag "insideBUpdate" to true on its onchain state, which A checks to make sure it's being called from B.
 * This flag is also reset by the method that A calls, so it's guaranteed to always be false when we're not inside a B update.
 * That way, both A and B can be sure that they're updating together.
 *
 * To understand the flow of this example in detail, keep in mind that zkApp updates are applied top-to-bottom:
 * 1. First, the account update created by `B.updateWithA()` is applied. It sets `insideBUpdate = true`.
 * 2. Then, `A.updateWithB()` is applied.
 * 3. Finally, `B.assertInsideUpdate()` is applied. It checks that `insideBUpdate = true` and sets it back to false.
 */

const aKey = PrivateKey.randomKeypair();
const bKey = PrivateKey.randomKeypair();
const tokenAKey = PrivateKey.randomKeypair();
const tokenBKey = PrivateKey.randomKeypair();
const adminContractAKey = PrivateKey.randomKeypair();
const adminContractBKey = PrivateKey.randomKeypair();
const tokenA = new FungibleToken(tokenAKey.publicKey);
const tokenB = new FungibleToken(tokenBKey.publicKey);
const tokenIdA = tokenA.deriveTokenId();
const tokenIdB = tokenB.deriveTokenId();
const fee = "100000000";

class A extends SmartContract {
  @state(Field) N = State(Field(0));

  @method async updateWithB() {
    let N = this.N.getAndRequireEquals();
    this.N.set(N.add(1));

    // make sure that this can only be called from `B.updateWithA()`
    // note: we need to hard-code B's pubkey for this to work, can't just take one from user input
    let b = new B(bKey.publicKey, tokenIdB);
    await b.assertInsideUpdate();
    await tokenB.approveAccountUpdate(b.self);
  }
}

class B extends SmartContract {
  @state(Field) twoToN = State(Field(1));

  // boolean flag which is only active during `updateWithA()`
  @state(Bool) insideBUpdate = State(Bool(false));

  @method async updateWithA() {
    // update field N in the A account with aPubKey by incrementing by 1
    let a = new A(aKey.publicKey, tokenIdA);
    await a.updateWithB();
    await tokenA.approveAccountUpdate(a.self);

    // update our own state by multiplying by 2
    let twoToN = this.twoToN.getAndRequireEquals();
    this.twoToN.set(twoToN.mul(2));

    // set up our state so that A knows it's called from here
    this.insideBUpdate.set(Bool(true));
  }

  /**
   * Method that can only be called from inside `B.updateWithA()`
   */
  @method async assertInsideUpdate() {
    this.insideBUpdate.requireEquals(Bool(true));
    this.insideBUpdate.set(Bool(false));
  }
}

const a = new A(aKey.publicKey, tokenIdA);
const b = new B(bKey.publicKey, tokenIdB);

describe("Flag", () => {
  it(`should use flag`, async () => {
    const Local = await Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const [sender, adminA, adminB, user] = Local.testAccounts;
    const cache: Cache = Cache.FileSystem("./cache");
    await A.compile({ cache });
    await B.compile({ cache });
    await FungibleTokenAdmin.compile({ cache });
    await FungibleToken.compile({ cache });
    await deployToken({
      tokenSymbol: "JOINTA",
      sender,
      adminKey: adminA,
      adminContractKey: adminContractAKey,
      tokenContractKey: tokenAKey,
    });
    await deployToken({
      tokenSymbol: "JOINTB",
      sender,
      adminKey: adminB,
      adminContractKey: adminContractBKey,
      tokenContractKey: tokenBKey,
    });
    const tx = await Mina.transaction(
      { sender, fee, memo: "deploy" },
      async () => {
        AccountUpdate.fundNewAccount(sender, 2);
        await a.deploy({});
        await b.deploy({});
        await tokenA.approveAccountUpdate(a.self);
        await tokenB.approveAccountUpdate(b.self);
      }
    );
    await tx.prove();
    await tx.sign([sender.key, aKey.privateKey, bKey.privateKey]).send();
    let N = a.N.get();
    let twoToN = b.twoToN.get();
    let insideBUpdate = b.insideBUpdate.get();
    console.log("Data", {
      N: N.toBigInt(),
      twoToN: twoToN.toBigInt(),
      insideBUpdate: insideBUpdate.toBoolean(),
    });

    const tx2 = await Mina.transaction(
      { sender, fee: "100000000", memo: "use flag" },
      async () => {
        await b.updateWithA();
        await tokenB.approveAccountUpdate(b.self);
      }
    );
    await tx2.prove();
    tx2.sign([sender.key]);
    console.log(
      `tx has ${
        JSON.parse(tx2.toJSON()).accountUpdates.length + 1
      } AccountUpdates:`,
      tx2.toPretty()
    );
    await tx2.send();
    N = a.N.get();
    twoToN = b.twoToN.get();
    insideBUpdate = b.insideBUpdate.get();
    console.log("Data", {
      N: N.toBigInt(),
      twoToN: twoToN.toBigInt(),
      insideBUpdate: insideBUpdate.toBoolean(),
    });
  });
});

export async function deployToken(params: {
  tokenSymbol: string;
  sender: Mina.TestPublicKey;
  adminKey: PublicKey;
  adminContractKey: {
    privateKey: PrivateKey;
    publicKey: PublicKey;
  };
  tokenContractKey: {
    privateKey: PrivateKey;
    publicKey: PublicKey;
  };
}) {
  const { tokenSymbol, sender, adminKey, adminContractKey, tokenContractKey } =
    params;

  const adminContract = new FungibleTokenAdmin(adminContractKey.publicKey);
  const tokenContract = new FungibleToken(tokenContractKey.publicKey);

  const tx = await Mina.transaction(
    { sender, fee, memo: "deploy token" },
    async () => {
      AccountUpdate.fundNewAccount(sender, 3);
      await adminContract.deploy({ adminPublicKey: adminKey });
      await tokenContract.deploy({
        symbol: tokenSymbol,
        src: "mina-fungible-token",
      });
      await tokenContract.initialize(
        adminContractKey.publicKey,
        UInt8.from(9),
        // We can set `startPaused` to `Bool(false)` here, because we are doing an atomic deployment
        // If you are not deploying the admin and token contracts in the same transaction,
        // it is safer to start the tokens paused, and resume them only after verifying that
        // the admin contract has been deployed
        Bool(false)
      );
    }
  );
  await tx.prove();
  await tx
    .sign([
      sender.key,
      tokenContractKey.privateKey,
      adminContractKey.privateKey,
    ])
    .send()
    .wait();
}
