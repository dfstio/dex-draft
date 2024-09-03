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
  AccountUpdateForest,
} from "o1js";

import {
  zkCloudWorkerClient,
  blockchain,
  sleep,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  serializeFields,
  accountBalanceMina,
} from "zkcloudworker";
import { zkcloudworker } from "..";
import { FungibleToken } from "../src/FungibleToken";
import { FungibleTokenAdmin } from "../src/FungibleTokenAdmin";
import { OfferContract } from "../src/offer";
import { BidContract } from "../src/bid";
import { USER_PRIVATE_KEY, USER_PUBLIC_KEY, TOKEN_ADDRESS } from "../env.json";
import packageJson from "../package.json";
import { JWT } from "../env.json";
import { off } from "process";

setNumberOfWorkers(8);

const { name: repo, author: developer } = packageJson;
const { chain, compile, deploy, send, useLocalCloudWorker } =
  processArguments();

const api = new zkCloudWorkerClient({
  jwt: useLocalCloudWorker ? "local" : JWT,
  zkcloudworker,
  chain,
});

let deployer: PrivateKey;
let sender: PublicKey;

const oneValues: number[] = [];
const manyValues: number[][] = [];

const adminPrivateKey = PrivateKey.random();
const adminPublicKey = adminPrivateKey.toPublicKey();
const buyerPrivateKey = PrivateKey.random();
const buyerPublicKey = buyerPrivateKey.toPublicKey();
const offerPrivateKey = PrivateKey.random();
const offerPublicKey = offerPrivateKey.toPublicKey();
const bidPrivateKey = PrivateKey.random();
const bidPublicKey = bidPrivateKey.toPublicKey();
const contractPrivateKey = PrivateKey.random();
const contractPublicKey =
  chain === "devnet"
    ? PublicKey.fromBase58(TOKEN_ADDRESS)
    : contractPrivateKey.toPublicKey();
const userPrivateKey = PrivateKey.fromBase58(USER_PRIVATE_KEY);
const userPublicKey = PublicKey.fromBase58(USER_PUBLIC_KEY);
const zkApp = new FungibleToken(contractPublicKey);
const tokenId = zkApp.deriveTokenId();
let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let offerVerificationKey: VerificationKey;
let bidVerificationKey: VerificationKey;
let blockchainInitialized = false;

describe("Token Worker", () => {
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
      deployer = local.testAccounts[0].key;
    } else {
      console.log("non-local chain:", chain);
      await initBlockchain(chain);
      deployer = PrivateKey.fromBase58(USER_PRIVATE_KEY);
    }

    process.env.DEPLOYER_PRIVATE_KEY = deployer.toBase58();
    process.env.DEPLOYER_PUBLIC_KEY = deployer.toPublicKey().toBase58();

    console.log("contract address:", contractPublicKey.toBase58());
    console.log("offer contract address:", offerPublicKey.toBase58());
    console.log("bid contract address:", bidPublicKey.toBase58());
    console.log("admin contract address:", adminPublicKey.toBase58());
    console.log("user address:", userPublicKey.toBase58());
    console.log("buyer address:", buyerPublicKey.toBase58());
    sender = deployer.toPublicKey();
    console.log("sender:", sender.toBase58());
    console.log("Sender balance:", await accountBalanceMina(sender));
    expect(deployer).toBeDefined();
    expect(sender).toBeDefined();
    expect(deployer.toPublicKey().toBase58()).toBe(sender.toBase58());
    Memory.info("blockchain initialized");
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
      console.log(`Deploying contract...`);

      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: userPublicKey });
      await fetchMinaAccount({ publicKey: buyerPublicKey });
      if (!Mina.hasAccount(userPublicKey)) {
        const topupTx = await Mina.transaction(
          {
            sender,
            fee: await fee(),
          },
          async () => {
            const senderUpdate = AccountUpdate.createSigned(sender);
            senderUpdate.balance.subInPlace(1000000000);
            senderUpdate.send({ to: userPublicKey, amount: 100_000_000_000 });
          }
        );
        topupTx.sign([deployer]);
        await sendTx(topupTx, "topup user");
      }
      if (!Mina.hasAccount(buyerPublicKey)) {
        const topupTx = await Mina.transaction(
          {
            sender,
            fee: await fee(),
          },
          async () => {
            const senderUpdate = AccountUpdate.createSigned(sender);
            senderUpdate.balance.subInPlace(1000000000);
            senderUpdate.send({ to: buyerPublicKey, amount: 100_000_000_000 });
          }
        );
        topupTx.sign([deployer]);
        await sendTx(topupTx, "topup buyer");
      }
      const adminContract = new FungibleTokenAdmin(adminPublicKey);
      const offerContract = new OfferContract(offerPublicKey, tokenId);
      const bidContract = new BidContract(bidPublicKey);
      await fetchMinaAccount({ publicKey: sender, force: true });

      const tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 3);
          await adminContract.deploy({ adminPublicKey });
          await zkApp.deploy({
            symbol: "ZKCW1",
            src: "https://zkcloudworker.com",
          });
          await zkApp.initialize(
            adminPublicKey,
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
      tx.sign([deployer, contractPrivateKey, adminPrivateKey]);

      await sendTx(tx, "deploy");

      const offerDeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "offer deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await offerContract.deploy({});
          await zkApp.approveAccountUpdate(offerContract.self);
        }
      );
      await offerDeploy.prove();
      offerDeploy.sign([deployer, offerPrivateKey]);

      await sendTx(offerDeploy, "offer deploy");

      const bidDeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "bid deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await bidContract.deploy({});
          await zkApp.approveAccountUpdate(bidContract.self);
        }
      );
      await bidDeploy.prove();
      bidDeploy.sign([deployer, bidPrivateKey]);

      await sendTx(bidDeploy, "bid deploy");
      Memory.info("deployed");

      const mintTx = await Mina.transaction(
        {
          sender,
          fee: await fee(),
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await zkApp.mint(userPublicKey, new UInt64(1000e9));
        }
      );
      await mintTx.prove();
      mintTx.sign([deployer, adminPrivateKey]);
      await sendTx(mintTx, "mint");
      const userTokenBalance = Mina.getBalance(userPublicKey, tokenId);
      console.log(
        "User token balance after mint:",
        userTokenBalance.toBigInt() / 1_000_000_000n
      );

      const mintTx2 = await Mina.transaction(
        {
          sender,
          fee: await fee(),
        },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await zkApp.mint(buyerPublicKey, new UInt64(1e9));
        }
      );
      await mintTx2.prove();
      mintTx2.sign([deployer, adminPrivateKey]);
      await sendTx(mintTx2, "mint2");
      const buyerTokenBalance0 = Mina.getBalance(buyerPublicKey, tokenId);
      console.log(
        "Buyer token balance after mint:",
        buyerTokenBalance0.toBigInt() / 1_000_000_000n
      );

      console.log("Preparing offer tx");

      const offerTx = await Mina.transaction(
        {
          sender: userPublicKey,
          fee: await fee(),
        },
        async () => {
          await offerContract.offer(
            contractPublicKey,
            UInt64.from(10e9),
            UInt64.from(30e9)
          );
          await zkApp.approveAccountUpdate(offerContract.self);
        }
      );
      await offerTx.prove();
      offerTx.sign([userPrivateKey]);
      console.log(
        "Offer tx au:",
        JSON.parse(offerTx.toJSON()).accountUpdates.length
      );
      await sendTx(offerTx, "offer");
      const userTokenBalance1 = Mina.getBalance(userPublicKey, tokenId);
      console.log(
        "User token balance after deposit:",
        userTokenBalance1.toBigInt() / 1_000_000_000n
      );
      const offerTokenBalance = Mina.getBalance(offerPublicKey, tokenId);
      console.log(
        "Offer token balance after deposit:",
        offerTokenBalance.toBigInt() / 1_000_000_000n
      );

      const userBalance1 = await accountBalanceMina(userPublicKey);
      console.log("User balance after deposit:", userBalance1);
      const buyerBalance1 = await accountBalanceMina(buyerPublicKey);
      console.log("Buyer balance before buy:", buyerBalance1);
      /*
      console.log("Preparing transfer tx");

      const transferTx = await Mina.transaction(
        {
          sender: buyerPublicKey,
          fee: await fee(),
        },
        async () => {
          AccountUpdate.fundNewAccount(buyerPublicKey, 1);
          await zkApp.transfer(
            offerPublicKey,
            buyerPublicKey,
            UInt64.from(10e9)
          );
        }
      );
      await transferTx.prove();
      transferTx.sign([buyerPrivateKey, offerPrivateKey]);
      //console.log("Transfer tx:", transferTx.toPretty());
      await sendTx(transferTx, "transfer"); // should fail
      */

      console.log("Preparing bid tx");

      const bidTx = await Mina.transaction(
        {
          sender: buyerPublicKey,
          fee: await fee(),
        },
        async () => {
          await bidContract.bid(
            contractPublicKey,
            UInt64.from(10e9),
            UInt64.from(30e9)
          );
          await zkApp.approveAccountUpdate(offerContract.self);
        }
      );
      await bidTx.prove();
      bidTx.sign([buyerPrivateKey]);
      //console.log("Buy tx:", buyTx.toPretty());
      await sendTx(bidTx, "bid");

      console.log("Preparing settle tx");

      const settleTx = await Mina.transaction(
        {
          sender: buyerPublicKey,
          fee: await fee(),
        },

        async () => {
          //AccountUpdate.fundNewAccount(buyerPublicKey, 1);

          await offerContract.settle(bidPublicKey, buyerPublicKey);
          //console.log("Settle tx au:", (au.data as any).option.value);
          //console.log("Settle tx self:", offerContract.self);
          //await zkApp.approveBase(au);
          await zkApp.approveAccountUpdate(offerContract.self);
        }
      );
      console.log(
        "Settle tx au:",
        JSON.parse(settleTx.toJSON()).accountUpdates.length
      );
      console.log("Settle tx:", settleTx.toPretty());
      await settleTx.prove();
      settleTx.sign([buyerPrivateKey]);

      await sendTx(settleTx, "settle");

      /*
      console.log("Preparing sell tx");

      const sellTx = await Mina.transaction(
        {
          sender: userPublicKey,
          fee: await fee(),
        },

        async () => {
          AccountUpdate.fundNewAccount(userPublicKey, 1);
          await bidContract.sell(userPublicKey);
          await zkApp.approveAccountUpdate(offerContract.self);
        }
      );
      await sellTx.prove();
      sellTx.sign([userPrivateKey]);
      console.log(
        "Sell tx au:",
        JSON.parse(sellTx.toJSON()).accountUpdates.length
      );
      await sendTx(sellTx, "sell");

     
      console.log("Preparing buy tx");

      const buyTx = await Mina.transaction(
        {
          sender: buyerPublicKey,
          fee: await fee(),
        },
        async () => {
          AccountUpdate.fundNewAccount(buyerPublicKey, 1);
          await offerContract.buy();
          await zkApp.approveAccountUpdate(offerContract.self);
        }
      );
      await buyTx.prove();
      buyTx.sign([buyerPrivateKey]);
      //console.log("Buy tx:", buyTx.toPretty());
      await sendTx(buyTx, "buy");
      */

      const userBalance2 = await accountBalanceMina(userPublicKey);
      console.log("User balance after buy:", userBalance2);
      const buyerBalance2 = await accountBalanceMina(buyerPublicKey);
      console.log("Buyer balance after buy:", buyerBalance2);
      const userTokenBalance2 = Mina.getBalance(userPublicKey, tokenId);
      console.log(
        "User token balance after buy:",
        userTokenBalance2.toBigInt() / 1_000_000_000n
      );
      const offerTokenBalance1 = Mina.getBalance(offerPublicKey, tokenId);
      console.log(
        "Offer token balance after buy:",
        offerTokenBalance1.toBigInt() / 1_000_000_000n
      );
      const buyerTokenBalance = Mina.getBalance(buyerPublicKey, tokenId);
      console.log(
        "Buyer token balance after buy:",
        buyerTokenBalance.toBigInt() / 1_000_000_000n
      );
    });
  }

  if (send) {
    it(`should send tokens`, async () => {
      expect(blockchainInitialized).toBe(true);
      console.time(`Tokens sent`);

      const answer = await api.execute({
        developer,
        repo,
        transactions: [],
        task: "send",
        args: JSON.stringify({
          contractAddress: contractPublicKey.toBase58(),
          from: userPrivateKey.toBase58(),
          to: PrivateKey.random().toPublicKey().toBase58(),
          amount: 100_000_000,
        }),
        metadata: `send tokens`,
      });
      console.log("answer:", answer);
      expect(answer).toBeDefined();
      expect(answer.success).toBe(true);
      const jobId = answer.jobId;
      expect(jobId).toBeDefined();
      if (jobId === undefined) throw new Error("Job ID is undefined");
      const oneResult = await api.waitForJobResult({
        jobId,
        printLogs: true,
      });
      console.log("Token transfer result:", oneResult.result.result);

      console.timeEnd(`Tokens sent`);
      Memory.info(`Tokens sent`);
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

async function sendTx(
  tx: Mina.Transaction<false, true> | Mina.Transaction<true, true>,
  description?: string
) {
  try {
    let txSent;
    let sent = false;
    while (!sent) {
      txSent = await tx.safeSend();
      if (txSent.status == "pending") {
        sent = true;
        console.log(
          `${description ?? ""} tx sent: hash: ${txSent.hash} status: ${
            txSent.status
          }`
        );
      } else if (chain === "zeko") {
        console.log("Retrying Zeko tx");
        await sleep(10000);
      } else {
        console.log(
          `${description ?? ""} tx NOT sent: hash: ${txSent?.hash} status: ${
            txSent?.status
          }`,
          txSent?.errors
        );
        return "Error sending transaction";
      }
    }
    if (txSent === undefined) throw new Error("txSent is undefined");
    if (txSent.errors.length > 0) {
      console.error(
        `${description ?? ""} tx error: hash: ${txSent.hash} status: ${
          txSent.status
        }  errors: ${txSent.errors}`
      );
    }

    if (txSent.status === "pending") {
      console.log(`Waiting for tx inclusion...`);
      const txIncluded = await txSent.safeWait();
      console.log(
        `${description ?? ""} tx included into block: hash: ${
          txIncluded.hash
        } status: ${txIncluded.status}`
      );
    }
  } catch (error) {
    if (chain !== "zeko") console.error("Error sending tx", error);
  }
  if (chain !== "local") await sleep(10000);
}

/*
      console.log("Preparing transfer tx");

      const transferTx = await Mina.transaction(
        {
          sender: buyerPublicKey,
          fee: await fee(),
        },
        async () => {
          AccountUpdate.fundNewAccount(buyerPublicKey, 1);
          await zkApp.transfer(
            offerPublicKey,
            buyerPublicKey,
            UInt64.from(10e9)
          );
        }
      );
      await transferTx.prove();
      transferTx.sign([buyerPrivateKey, offerPrivateKey]);
      console.log("Transfer tx:", transferTx.toPretty());
      await sendTx(transferTx, "transfer");
      */
