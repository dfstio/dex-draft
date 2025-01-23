import { describe, expect, it } from "@jest/globals";
import {
  Mina,
  AccountUpdate,
  VerificationKey,
  UInt64,
  Cache,
  setNumberOfWorkers,
  Bool,
  UInt8,
  UInt32,
} from "o1js";
import {
  blockchain,
  Memory,
  fetchMinaAccount,
  fee,
  initBlockchain,
  sendTx,
  accountBalanceMina,
} from "zkcloudworker";
import { BondingCurveFungibleToken, BondingCurveAdmin } from "../src/bonding";
import { AccountKey, topupAccounts } from "../src/key";
import { getAccounts } from "../src/addresses";
import { printAddresses, printBalances } from "../src/print";

setNumberOfWorkers(8);

const { chain, compile, deploy, mint, redeem } = processArguments();

const {
  sender,
  user,
  buyer,
  admin,
  feeMaster,
  tokenContractKey,
  adminContractKey,
} = getAccounts();

const tokenContract = new BondingCurveFungibleToken(tokenContractKey);
const tokenId = tokenContract.deriveTokenId();
const adminContract = new BondingCurveAdmin(adminContractKey);
const adminTokenId = adminContract.deriveTokenId();

let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let blockchainInitialized = false;

describe("Token Offer", () => {
  it(`should initialize blockchain`, async () => {
    Memory.info("initializing blockchain");

    if (chain === "local" || chain === "lightnet") {
      console.log("local chain:", chain);
      const { keys } = await initBlockchain(chain, 2);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      if (keys.length < 2) throw new Error("Invalid keys");
      const topup: AccountKey = Object.assign(keys[0], {
        key: keys[0].key,
        name: "topup",
      });
      await topupAccounts({
        accounts: [sender, user, buyer, admin, feeMaster],
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
    ]);
    await printBalances({ accounts: [sender, user, buyer, admin, feeMaster] });
    blockchainInitialized = true;
  });

  if (compile) {
    it(`should compile contract`, async () => {
      expect(blockchainInitialized).toBe(true);
      console.log("Analyzing contracts methods...");
      console.time("methods analyzed");
      const methods = [
        {
          name: "BondingCurveFungibleToken",
          result: await BondingCurveFungibleToken.analyzeMethods(),
          skip: true,
        },
        {
          name: "BondingCurveAdmin",
          result: await BondingCurveAdmin.analyzeMethods(),
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
      adminVerificationKey = (await BondingCurveAdmin.compile({ cache }))
        .verificationKey;
      console.timeEnd("FungibleTokenAdmin compiled");

      console.time("FungibleToken compiled");
      contractVerificationKey = (
        await BondingCurveFungibleToken.compile({
          cache,
        })
      ).verificationKey;
      console.timeEnd("FungibleToken compiled");

      console.timeEnd("compiled");
      console.log(
        "FungibleToken verification key",
        contractVerificationKey.hash.toJSON()
      );
      expect(contractVerificationKey.hash.toJSON()).toBe(
        "11275266297357989434659649579180929660472107786900344600948115953037388411671"
      );
      console.log(
        "FungibleTokenAdmin verification key",
        adminVerificationKey.hash.toJSON()
      );
      Memory.info("compiled");
    });
  }
  if (deploy) {
    it(`should deploy contract`, async () => {
      expect(blockchainInitialized).toBe(true);

      await fetchMinaAccount({ publicKey: sender, force: true });
      const balance = await accountBalanceMina(sender);
      console.log("Sender balance:", balance);
      if (balance < 5) throw new Error("Insufficient balance of sender");

      const tx = await Mina.transaction(
        { sender, fee: await fee(), memo: "deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 4);
          await adminContract.deploy({
            owner: admin,
            token: tokenContractKey,
            feeMaster,
          });
          adminContract.account.zkappUri.set("BondingCurveAdmin");
          await adminContract.initialize();
          await tokenContract.deploy({
            symbol: "TEST_A",
            src: "BondingCurve",
            allowUpdates: true,
          });
          await tokenContract.initialize(
            adminContractKey,
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
      tx.sign([sender.key, tokenContractKey.key, adminContractKey.key]);
      await sendTx({ tx, description: "deploy" });
    });
  }

  if (mint) {
    it(`should mint tokens`, async () => {
      await printBalances({
        accounts: [user, admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });

      await fetchMinaAccount({ publicKey: user, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: adminContractKey, force: true });
      await fetchMinaAccount({
        publicKey: adminContractKey,
        tokenId: adminTokenId,
        force: true,
      });
      const mint = await Mina.transaction(
        { sender: user, fee: await fee(), memo: "mint" },
        async () => {
          await adminContract.mint(
            UInt64.from(100_000_000_000_000),
            UInt64.from(10_000)
          );
          //await tokenContract.approveAccountUpdate(tokenContract.self);
        }
      );
      await mint.prove();
      mint.sign([user.key]);
      await sendTx({ tx: mint, description: "mint" });
      await printBalances({
        accounts: [user, admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });
      await printBalances({
        accounts: [user, adminContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [adminContractKey],
        tokenId: adminTokenId,
        tokenName: "ADMIN",
      });

      await fetchMinaAccount({ publicKey: user, force: true });
      await fetchMinaAccount({ publicKey: user, tokenId, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: adminContractKey, force: true });
      await fetchMinaAccount({
        publicKey: adminContractKey,
        tokenId: adminTokenId,
        force: true,
      });
      const mint2 = await Mina.transaction(
        { sender: user, fee: await fee(), memo: "mint2" },
        async () => {
          await adminContract.mint(
            UInt64.from(200_000_000_000_000),
            UInt64.from(25_000)
          );
        }
      );
      await mint2.prove();
      mint2.sign([user.key]);
      await sendTx({ tx: mint2, description: "mint2" });
      await printBalances({
        accounts: [user, admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });
      await printBalances({
        accounts: [user, adminContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [adminContractKey],
        tokenId: adminTokenId,
        tokenName: "ADMIN",
      });
    });
  }

  if (redeem) {
    it(`should redeem tokens`, async () => {
      await printBalances({
        accounts: [user, admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });

      await fetchMinaAccount({ publicKey: user, force: true });
      await fetchMinaAccount({ publicKey: user, tokenId, force: true });
      await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenContractKey,
        tokenId,
        force: true,
      });
      await fetchMinaAccount({ publicKey: adminContractKey, force: true });
      await fetchMinaAccount({
        publicKey: adminContractKey,
        tokenId: adminTokenId,
        force: true,
      });
      const redeem = await Mina.transaction(
        { sender: user, fee: await fee(), memo: "redeem" },
        async () => {
          await adminContract.redeem(
            UInt64.from(300_000_000_000_000),
            UInt64.from(15_000),
            UInt32.from(50)
          );
        }
      );
      await redeem.prove();
      redeem.sign([user.key]);
      await sendTx({ tx: redeem, description: "redeem" });
      await printBalances({
        accounts: [user, admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });
      await printBalances({
        accounts: [user, adminContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [adminContractKey],
        tokenId: adminTokenId,
        tokenName: "ADMIN",
      });
    });
  }
});

function processArguments(): {
  chain: blockchain;
  compile: boolean;
  deploy: boolean;
  mint: boolean;
  redeem: boolean;
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
  const mint = getArgument("mint") ?? "true";
  const redeem = getArgument("redeem") ?? "true";

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
    mint: mint === "true",
    redeem: redeem === "true",
    useLocalCloudWorker: cloud
      ? cloud === "local"
      : chainName === "local" || chainName === "lightnet",
  };
}
