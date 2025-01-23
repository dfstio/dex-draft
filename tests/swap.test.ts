import { describe, expect, it } from "@jest/globals";
import {
  Mina,
  AccountUpdate,
  VerificationKey,
  UInt64,
  Cache,
  setNumberOfWorkers,
} from "o1js";

import {
  blockchain,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  sendTx,
} from "zkcloudworker";
import { FungibleToken, FungibleTokenAdmin } from "@minatokens/token";
import { SwapOffer } from "../src/swap";
import { useChain } from "../src/send";
import { AccountKey, topupAccounts } from "../src/key";
import { getAccounts } from "../src/addresses";
import { printAddresses, printBalances } from "../src/print";
import { deployToken } from "../src/deploy";
import { mint } from "../src/mint";

setNumberOfWorkers(8);

const { chain, compile, deploy, debugAU, proofs } = processArguments();
const {
  sender,
  userA,
  userB,
  adminA,
  adminB,
  tokenAKey,
  tokenBKey,
  adminAKey,
  adminBKey,
  swapAKey,
  swapBKey,
  bot,
} = getAccounts();

const tokenA = new FungibleToken(tokenAKey);
const tokenAId = tokenA.deriveTokenId();
const tokenB = new FungibleToken(tokenBKey);
const tokenBId = tokenB.deriveTokenId();
const adminAContract = new FungibleTokenAdmin(adminAKey);
const adminBContract = new FungibleTokenAdmin(adminBKey);
const swapA = new SwapOffer(swapAKey, tokenAId);
const swapB = new SwapOffer(swapBKey, tokenBId);
let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let swapVerificationKey: VerificationKey;
let blockchainInitialized = false;

describe("Token Offer", () => {
  it(`should initialize blockchain`, async () => {
    Memory.info("initializing blockchain");

    if (chain === "local" || chain === "lightnet") {
      console.log("local chain:", chain);

      const { keys } = await initBlockchain(chain, 2, proofs);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      if (keys.length < 2) throw new Error("Invalid keys");

      // const local = await Mina.LocalBlockchain({
      //   proofsEnabled: false,
      // });
      // Mina.setActiveInstance(local);
      const topup: AccountKey = Object.assign(keys[0], {
        key: keys[0].key,
        name: "topup",
      });
      await topupAccounts({
        accounts: [sender, userA, userB, adminA, adminB, bot],
        sender: topup,
        amountInMina: 100,
      });
    } else {
      console.log("non-local chain:", chain);
      await initBlockchain(chain);
    }
    await printAddresses([
      sender,
      userA,
      userB,
      adminA,
      adminB,
      adminAKey,
      adminBKey,
      tokenAKey,
      tokenBKey,
      swapAKey,
      swapBKey,
      bot,
    ]);
    console.log("tokenId A:", tokenAId.toJSON());
    console.log("tokenId B:", tokenBId.toJSON());
    await printBalances({
      accounts: [sender, userA, userB, adminA, adminB, bot],
    });
    blockchainInitialized = true;
  });

  if (compile) {
    it(`should compile contract`, async () => {
      expect(blockchainInitialized).toBe(true);
      console.log("Analyzing contracts methods...");
      console.time("methods analyzed");
      const methods = [
        {
          name: "FungibleToken",
          result: await FungibleToken.analyzeMethods(),
          skip: true,
        },
        {
          name: "FungibleTokenAdmin",
          result: await FungibleTokenAdmin.analyzeMethods(),
          skip: true,
        },
        {
          name: "SwapOffer",
          result: await SwapOffer.analyzeMethods(),
          skip: true,
        },
      ];
      console.timeEnd("methods analyzed");
      const maxRows = 2 ** 16;
      for (const contract of methods) {
        // calculate the size of the contract - the sum or rows for each method
        const size = Object.values(contract.result).reduce(
          (acc, method) => acc + method.rows,
          0
        );
        // calculate percentage rounded to 0 decimal places
        const percentage = Math.round(((size * 100) / maxRows) * 100) / 100;

        console.log(
          `method's total size for a ${contract.name} is ${size} rows (${percentage}% of max ${maxRows} rows)`
        );
        if (contract.skip !== true)
          for (const method in contract.result) {
            console.log(method, `rows:`, (contract.result as any)[method].rows);
          }
      }

      console.time("compiled");
      console.log("Compiling contracts...");
      const cache: Cache = Cache.FileSystem("./cache");

      console.time("FungibleTokenAdmin compiled");
      adminVerificationKey = (await FungibleTokenAdmin.compile({ cache }))
        .verificationKey;
      console.timeEnd("FungibleTokenAdmin compiled");

      console.time("FungibleToken compiled");
      contractVerificationKey = (await FungibleToken.compile({ cache }))
        .verificationKey;
      console.timeEnd("FungibleToken compiled");

      console.time("SwapOffer compiled");
      swapVerificationKey = (await SwapOffer.compile({ cache }))
        .verificationKey;
      console.timeEnd("SwapOffer compiled");

      console.timeEnd("compiled");
      console.log(
        "FungibleToken verification key",
        contractVerificationKey.hash.toJSON()
      );
      console.log(
        "FungibleTokenAdmin verification key",
        adminVerificationKey.hash.toJSON()
      );
      console.log(
        "SwapOffer verification key",
        swapVerificationKey.hash.toJSON()
      );
      Memory.info("compiled");
    });
  }
  if (deploy) {
    it(`should deploy contract`, async () => {
      expect(blockchainInitialized).toBe(true);
      await deployToken({
        tokenSymbol: "TEST_A",
        tokenUri: "https://zkcloudworker.com",
        adminUri: "https://zkcloudworker.com",
        sender,
        adminKey: adminA,
        adminContractKey: adminAKey,
        tokenContractKey: tokenAKey,
      });

      await deployToken({
        tokenSymbol: "TEST_B",
        tokenUri: "https://zkcloudworker.com",
        adminUri: "https://zkcloudworker.com",
        sender,
        adminKey: adminB,
        adminContractKey: adminBKey,
        tokenContractKey: tokenBKey,
      });

      await mint({
        account: userA,
        sender,
        adminKey: adminA,
        adminContractKey: adminAKey,
        tokenContractKey: tokenAKey,
        amount: 1000,
      });

      await mint({
        account: userB,
        sender,
        adminKey: adminB,
        adminContractKey: adminBKey,
        tokenContractKey: tokenBKey,
        amount: 1000,
      });

      await mint({
        account: userB,
        sender,
        adminKey: adminA,
        adminContractKey: adminAKey,
        tokenContractKey: tokenAKey,
        amount: 1,
      });

      await mint({
        account: userA,
        sender,
        adminKey: adminB,
        adminContractKey: adminBKey,
        tokenContractKey: tokenBKey,
        amount: 1,
      });

      await mint({
        account: bot,
        sender,
        adminKey: adminA,
        adminContractKey: adminAKey,
        tokenContractKey: tokenAKey,
        amount: 100,
      });

      await mint({
        account: bot,
        sender,
        adminKey: adminB,
        adminContractKey: adminBKey,
        tokenContractKey: tokenBKey,
        amount: 100,
      });

      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: tokenAKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenAKey,
        tokenId: tokenAId,
        force: true,
      });
      const swapADeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "swap A deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await swapA.deploy({});
          await tokenA.approveAccountUpdate(swapA.self);
        }
      );
      await swapADeploy.prove();
      swapADeploy.sign([sender.key, swapAKey.key]);
      await sendTx({ tx: swapADeploy, description: "swap A deploy" });

      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: tokenBKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenBKey,
        tokenId: tokenBId,
        force: true,
      });
      const swapBDeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "swap B deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await swapB.deploy({});
          await tokenB.approveAccountUpdate(swapB.self);
        }
      );
      await swapBDeploy.prove();
      swapBDeploy.sign([sender.key, swapBKey.key]);
      await sendTx({ tx: swapBDeploy, description: "swap B deploy" });

      Memory.info("deployed");
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });

      console.log("Preparing offer A tx");
      await fetchMinaAccount({ publicKey: userA, force: true });
      await fetchMinaAccount({
        publicKey: userA,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: tokenAKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenAKey,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: swapAKey,
        tokenId: tokenAId,
        force: true,
      });

      const offerATx = await Mina.transaction(
        {
          sender: userA,
          fee: await fee(),
          memo: "offer A",
        },
        async () => {
          await swapA.offer(tokenAKey, tokenBKey, UInt64.from(10e9));
          await tokenA.approveAccountUpdate(swapA.self);
        }
      );
      await offerATx.prove();
      offerATx.sign([userA.key]);
      console.log(
        "Offer A tx au:",
        JSON.parse(offerATx.toJSON()).accountUpdates.length
      );
      await sendTx({ tx: offerATx, description: "offer A" });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });

      console.log("Preparing offer B tx");
      await fetchMinaAccount({ publicKey: userB, force: true });
      await fetchMinaAccount({
        publicKey: userB,
        tokenId: tokenBId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: tokenBKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenBKey,
        tokenId: tokenBId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: swapBKey,
        tokenId: tokenBId,
        force: true,
      });

      const offerBTx = await Mina.transaction(
        {
          sender: userB,
          fee: await fee(),
          memo: "offer B",
        },
        async () => {
          await swapB.offer(tokenBKey, tokenAKey, UInt64.from(10e9));
          await tokenB.approveAccountUpdate(swapB.self);
        }
      );
      await offerBTx.prove();
      offerBTx.sign([userB.key]);
      console.log(
        "Offer B tx au:",
        JSON.parse(offerBTx.toJSON()).accountUpdates.length
      );
      await sendTx({ tx: offerBTx, description: "offer B" });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });

      console.log("Preparing accept A tx");
      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({
        publicKey: userA,
        tokenId: tokenBId,
        force: false,
      });
      await fetchMinaAccount({
        publicKey: userB,
        tokenId: tokenAId,
        force: false,
      });
      await fetchMinaAccount({ publicKey: tokenAKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenAKey,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: tokenBKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenBKey,
        tokenId: tokenBId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: swapAKey,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: swapBKey,
        tokenId: tokenBId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bot,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bot,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bot,
        tokenId: tokenBId,
        force: true,
      });

      const acceptTxA = await Mina.transaction(
        {
          sender: bot,
          fee: await fee(),
          memo: "bot accept A",
        },

        async () => {
          await swapA.accept();
          await tokenA.approveAccountUpdate(swapA.self);
        }
      );
      await acceptTxA.prove();
      acceptTxA.sign([bot.key]);
      console.log(
        "Accept A tx au:",
        JSON.parse(acceptTxA.toJSON()).accountUpdates.length
      );
      //console.log("Accept A tx:", acceptTxA.toPretty());

      await sendTx({ tx: acceptTxA, description: "accept A" });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });

      console.log("Preparing accept B tx");
      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({
        publicKey: userA,
        tokenId: tokenBId,
        force: false,
      });
      await fetchMinaAccount({
        publicKey: userB,
        tokenId: tokenAId,
        force: false,
      });
      await fetchMinaAccount({ publicKey: tokenAKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenAKey,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: tokenBKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenBKey,
        tokenId: tokenBId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: swapAKey,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: swapBKey,
        tokenId: tokenBId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bot,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bot,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bot,
        tokenId: tokenBId,
        force: true,
      });

      const acceptTxB = await Mina.transaction(
        {
          sender: bot,
          fee: await fee(),
          memo: "bot accept B",
        },

        async () => {
          await swapB.accept();
          await tokenB.approveAccountUpdate(swapB.self);
        }
      );
      await acceptTxB.prove();
      acceptTxB.sign([bot.key]);
      console.log(
        "Accept B tx au:",
        JSON.parse(acceptTxB.toJSON()).accountUpdates.length
      );
      //console.log("Accept B tx:", acceptTxB.toPretty());

      await sendTx({ tx: acceptTxB, description: "accept B" });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey, bot],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });
    });
  }
});

function processArguments(): {
  chain: blockchain;
  compile: boolean;
  deploy: boolean;
  debugAU: boolean;
  send: boolean;
  useLocalCloudWorker: boolean;
  proofs: boolean;
} {
  function getArgument(arg: string): string | undefined {
    const argument = process.argv.find((a) => a.startsWith("--" + arg));
    return argument?.split("=")[1];
  }

  const chainName = getArgument("chain") ?? "local";
  const shouldDeploy = getArgument("deploy") ?? "true";
  const shouldSend = getArgument("send") ?? "true";
  const shouldDebug = getArgument("debugAU") ?? "false";
  const compile = getArgument("compile");
  const cloud = getArgument("cloud");
  const proofs = getArgument("proofs") ?? "true";

  if (
    chainName !== "local" &&
    chainName !== "devnet" &&
    chainName !== "lightnet" &&
    chainName !== "zeko"
  )
    throw new Error("Invalid chain name");
  useChain(chainName as blockchain);
  return {
    chain: chainName as blockchain,
    compile:
      compile !== undefined
        ? compile === "true"
        : shouldDeploy === "true" || shouldSend === "true",
    deploy: shouldDeploy === "true",
    send: shouldSend === "true",
    debugAU: shouldDebug === "true",
    useLocalCloudWorker: cloud
      ? cloud === "local"
      : chainName === "local" || chainName === "lightnet",
    proofs: chainName === "local" ? proofs === "true" : true,
  };
}
