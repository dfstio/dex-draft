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
} from "o1js";

/**
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

class A extends SmartContract {
  @state(Field) N = State(Field(0));

  @method async updateWithB() {
    let N = this.N.getAndRequireEquals();
    this.N.set(N.add(1));

    // make sure that this can only be called from `B.updateWithA()`
    // note: we need to hard-code B's pubkey for this to work, can't just take one from user input
    let b = new B(bKey.publicKey);
    await b.assertInsideUpdate();
  }
}

class B extends SmartContract {
  @state(Field) twoToN = State(Field(1));

  // boolean flag which is only active during `updateWithA()`
  @state(Bool) insideBUpdate = State(Bool(false));

  @method async updateWithA() {
    // update field N in the A account with aPubKey by incrementing by 1
    let a = new A(aKey.publicKey);
    await a.updateWithB();

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

describe("Flag", () => {
  it(`should use flag`, async () => {
    const Local = await Mina.LocalBlockchain();
    Mina.setActiveInstance(Local);
    const sender = Local.testAccounts[0];
    const a = new A(aKey.publicKey);
    const b = new B(bKey.publicKey);
    const cache: Cache = Cache.FileSystem("./cache");
    await A.compile();
    await B.compile();
    const tx = await Mina.transaction(
      { sender, fee: "100000000", memo: "deploy" },
      async () => {
        AccountUpdate.fundNewAccount(sender, 2);
        await a.deploy({});
        await b.deploy({});
      }
    );
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
