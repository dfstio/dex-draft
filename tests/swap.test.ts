import { describe, expect, it } from "@jest/globals";
import {
  PrivateKey,
  Mina,
  AccountUpdate,
  VerificationKey,
  UInt64,
  Cache,
  PublicKey,
  setNumberOfWorkers,
  UInt8,
  Bool,
} from "o1js";

import {
  zkCloudWorkerClient,
  blockchain,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  accountBalanceMina,
  sleep,
} from "zkcloudworker";
import { zkcloudworker } from "..";
import { FungibleToken } from "../src/FungibleToken";
import { FungibleTokenAdmin } from "../src/FungibleTokenAdmin";
import { SwapContract } from "../src/swap";
import { JWT, USERS_PRIVATE_KEYS, CONTRACTS_PRIVATE_KEYS } from "../env.json";
import { sendTx, useChain } from "../src/send";
import { AccountKey, getAccountKeys, topupAccounts } from "../src/key";
import { printAddresses, printBalances } from "../src/print";
import { deployToken } from "../src/deploy";
import { mint } from "../src/mint";

setNumberOfWorkers(8);

const { chain, compile, deploy, send, useLocalCloudWorker } =
  processArguments();

const [sender, user, buyer, admin, adminA, adminB, userA, userB] =
  getAccountKeys({
    names: [
      "sender",
      "user",
      "buyer",
      "admin",
      "adminA",
      "adminB",
      "userA",
      "userB",
    ],
    privateKeys: USERS_PRIVATE_KEYS,
  });

const [
  tokenContractKey,
  adminContractKey,
  offerContractKey,
  bidContractKey,
  tokenAKey,
  tokenBKey,
  adminAKey,
  adminBKey,
  swapAKey,
  swapBKey,
] = getAccountKeys({
  names: [
    "tokenContract",
    "adminContract",
    "offerContract",
    "bidContract",
    "tokenA",
    "tokenB",
    "adminA",
    "adminB",
    "swapA",
    "swapB",
  ],
  privateKeys: CONTRACTS_PRIVATE_KEYS,
});

const tokenA = new FungibleToken(tokenAKey);
const tokenAId = tokenA.deriveTokenId();
const tokenB = new FungibleToken(tokenBKey);
const tokenBId = tokenB.deriveTokenId();
const adminAContract = new FungibleTokenAdmin(adminAKey);
const adminBContract = new FungibleTokenAdmin(adminBKey);
const swapA = new SwapContract(swapAKey, tokenAId);
const swapB = new SwapContract(swapBKey, tokenBId);
let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let swapVerificationKey: VerificationKey;
let blockchainInitialized = false;

describe("Token Offer", () => {
  it(`should initialize blockchain`, async () => {
    Memory.info("initializing blockchain");

    if (chain === "local" || chain === "lightnet") {
      console.log("local chain:", chain);
      /*
      const { keys } = await initBlockchain(chain, 2);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      if (keys.length < 2) throw new Error("Invalid keys");
      deployer = keys[0].key;
      */
      const local = await Mina.LocalBlockchain({
        proofsEnabled: false,
      });
      Mina.setActiveInstance(local);
      const topup: AccountKey = Object.assign(local.testAccounts[0], {
        key: local.testAccounts[0].key,
        name: "topup",
      });
      await topupAccounts({
        accounts: [sender, userA, userB, adminA, adminB],
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
    ]);
    console.log("tokenId A:", tokenAId.toBigInt().toString(16));
    console.log("tokenId B:", tokenBId.toBigInt().toString(16));
    await printBalances({ accounts: [sender, userA, userB, adminA, adminB] });
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
          name: "SwapContract",
          result: await SwapContract.analyzeMethods(),
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

      console.time("SwapContract compiled");
      swapVerificationKey = (await SwapContract.compile({ cache }))
        .verificationKey;
      console.timeEnd("SwapContract compiled");

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
        "SwapContract verification key",
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
      await sendTx(swapADeploy, "swap A deploy");

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
      await sendTx(swapBDeploy, "swap B deploy");

      Memory.info("deployed");
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
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
      await sendTx(offerATx, "offer A");
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
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
      await sendTx(offerBTx, "offer B");
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });

      console.log("Preparing settle tx");
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

      const settleTx = await Mina.transaction(
        {
          sender,
          fee: await fee(),
          memo: "swap settle",
        },

        async () => {
          //AccountUpdate.fundNewAccount(sender, 1);
          await swapA.settle(tokenAKey, tokenBKey, swapBKey, tokenBId, userB);

          await tokenA.approveAccountUpdate(swapA.self);
        }
      );
      await settleTx.prove();
      settleTx.sign([sender.key]);
      console.log(
        "Settle tx au:",
        JSON.parse(settleTx.toJSON()).accountUpdates.length
      );
      console.log("Settle tx:", settleTx.toPretty());

      await sendTx(settleTx, "settle");
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB, swapAKey, swapBKey],
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
  send: boolean;
  useLocalCloudWorker: boolean;
} {
  function getArgument(arg: string): string | undefined {
    const argument = process.argv.find((a) => a.startsWith("--" + arg));
    return argument?.split("=")[1];
  }

  const chainName = getArgument("chain") ?? "local";
  const shouldDeploy = getArgument("deploy") ?? "true";
  const shouldSend = getArgument("send") ?? "true";
  const compile = getArgument("compile");
  const cloud = getArgument("cloud");

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
    useLocalCloudWorker: cloud
      ? cloud === "local"
      : chainName === "local" || chainName === "lightnet",
  };
}
