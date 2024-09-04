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
import { OfferContract } from "../src/offer";
import { BidContract } from "../src/bid";
import { JWT, USERS_PRIVATE_KEYS, CONTRACTS_PRIVATE_KEYS } from "../env.json";
import { sendTx, useChain } from "../src/send";
import { AccountKey, getAccountKeys, topupAccounts } from "../src/key";
import { printAddresses, printBalances } from "../src/print";
import { deployToken } from "../src/deploy";
import { mint } from "../src/mint";

setNumberOfWorkers(8);

const { chain, compile, deploy, send, useLocalCloudWorker } =
  processArguments();

const [sender, user, buyer, admin] = getAccountKeys({
  names: ["sender", "user", "buyer", "admin"],
  privateKeys: USERS_PRIVATE_KEYS,
});

const [
  tokenContractKey,
  adminContractKey,
  offerContractKey,
  bidContractKey,
  swapContractKey,
] = getAccountKeys({
  names: [
    "tokenContract",
    "adminContract",
    "offerContract",
    "bidContract",
    "swapContract",
  ],
  privateKeys: CONTRACTS_PRIVATE_KEYS,
});

const tokenContract = new FungibleToken(tokenContractKey);
const tokenId = tokenContract.deriveTokenId();
const adminContract = new FungibleTokenAdmin(adminContractKey);
const offerContract = new OfferContract(offerContractKey, tokenId);
const bidContract = new BidContract(bidContractKey);

let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let offerVerificationKey: VerificationKey;
let bidVerificationKey: VerificationKey;
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
        proofsEnabled: true,
      });
      Mina.setActiveInstance(local);
      const topup: AccountKey = Object.assign(local.testAccounts[0], {
        key: local.testAccounts[0].key,
        name: "topup",
      });
      await topupAccounts({
        accounts: [sender, user, buyer, admin],
        sender: topup,
        amountInMina: 100,
      });
    } else {
      console.log("non-local chain:", chain);
      await initBlockchain(chain);
    }
    await printAddresses([
      sender,
      user,
      buyer,
      admin,
      tokenContractKey,
      adminContractKey,
      offerContractKey,
      bidContractKey,
    ]);
    await printBalances({ accounts: [sender, user, buyer, admin] });
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
          name: "OfferContract",
          result: await OfferContract.analyzeMethods(),
          skip: true,
        },
        {
          name: "BidContract",
          result: await BidContract.analyzeMethods(),
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

      console.time("OfferContract compiled");
      offerVerificationKey = (await OfferContract.compile({ cache }))
        .verificationKey;
      console.timeEnd("OfferContract compiled");

      console.time("BidContract compiled");
      bidVerificationKey = (await BidContract.compile({ cache }))
        .verificationKey;
      console.timeEnd("BidContract compiled");

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
        "OfferContract verification key",
        offerVerificationKey.hash.toJSON()
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
        adminKey: admin,
        adminContractKey,
        tokenContractKey,
      });

      await mint({
        account: user,
        sender,
        adminKey: admin,
        adminContractKey,
        tokenContractKey,
      });

      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      const offerDeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "offer deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await offerContract.deploy({});
          await tokenContract.approveAccountUpdate(offerContract.self);
        }
      );
      await offerDeploy.prove();
      offerDeploy.sign([sender.key, offerContractKey.key]);
      await sendTx(offerDeploy, "offer deploy");

      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      const bidDeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "bid deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await bidContract.deploy({});
          await tokenContract.approveAccountUpdate(bidContract.self);
        }
      );
      await bidDeploy.prove();
      bidDeploy.sign([sender.key, bidContractKey.key]);
      await sendTx(bidDeploy, "bid deploy");
      Memory.info("deployed");
      await printBalances({
        accounts: [user, buyer, offerContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [user, buyer, bidContractKey],
      });

      console.log("Preparing offer tx");
      await fetchMinaAccount({ publicKey: user, force: true });
      await fetchMinaAccount({ publicKey: user, tokenId, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: offerContractKey,
        tokenId,
        force: true,
      });

      const offerTx = await Mina.transaction(
        {
          sender: user,
          fee: await fee(),
        },
        async () => {
          await offerContract.offer(
            tokenContractKey,
            UInt64.from(10e9),
            UInt64.from(30e9)
          );
          await tokenContract.approveAccountUpdate(offerContract.self);
        }
      );
      await offerTx.prove();
      offerTx.sign([user.key]);
      console.log(
        "Offer tx au:",
        JSON.parse(offerTx.toJSON()).accountUpdates.length
      );
      await sendTx(offerTx, "offer");
      await printBalances({
        accounts: [user, buyer, offerContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [user, buyer, bidContractKey],
      });

      console.log("Preparing bid tx");
      await fetchMinaAccount({ publicKey: buyer, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: bidContractKey, force: true });

      const bidTx = await Mina.transaction(
        {
          sender: buyer,
          fee: await fee(),
        },
        async () => {
          await bidContract.bid(
            tokenContractKey,
            UInt64.from(10e9),
            UInt64.from(30e9)
          );
          await tokenContract.approveAccountUpdate(offerContract.self);
        }
      );
      await bidTx.prove();
      bidTx.sign([buyer.key]);
      await sendTx(bidTx, "bid");
      await printBalances({
        accounts: [user, buyer, offerContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [user, buyer, bidContractKey],
      });

      console.log("Preparing settle tx");
      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: user, force: true });
      await fetchMinaAccount({ publicKey: buyer, tokenId, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: offerContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: bidContractKey,
        force: true,
      });

      const settleTx = await Mina.transaction(
        {
          sender,
          fee: await fee(),
        },

        async () => {
          AccountUpdate.fundNewAccount(sender, 1);

          await offerContract.settle(bidContractKey, buyer);
          await tokenContract.approveAccountUpdate(offerContract.self);
        }
      );
      console.log(
        "Settle tx au:",
        JSON.parse(settleTx.toJSON()).accountUpdates.length
      );
      console.log("Settle tx:", settleTx.toPretty());
      await settleTx.prove();
      settleTx.sign([sender.key]);

      await sendTx(settleTx, "settle");
      await printBalances({
        accounts: [user, buyer, offerContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [user, buyer, bidContractKey],
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
