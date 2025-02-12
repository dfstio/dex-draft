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
  PrivateKey,
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
import {
  BondingCurveFungibleToken,
  FungibleTokenBondingCurveAdmin,
} from "@minatokens/token";
import { AccountKey, topupAccounts } from "../src/key";
import { getAccounts } from "../src/addresses";
import { printAddresses, printBalances } from "../src/print";

setNumberOfWorkers(8);
const NUMBER_OF_TRANSFERS = 500;

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
const adminContract = new FungibleTokenBondingCurveAdmin(adminContractKey);
const adminTokenId = adminContract.deriveTokenId();

let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let blockchainInitialized = false;

describe("Bonding Curve", () => {
  it(`should initialize blockchain`, async () => {
    Memory.info("initializing blockchain");

    if (chain === "local" || chain === "lightnet") {
      const Local = await Mina.LocalBlockchain({
        enforceTransactionLimits: false,
        proofsEnabled: true,
      });
      Mina.setActiveInstance(Local);
      console.log("local chain:", chain);
      //const { keys } = await initBlockchain(chain, 2);
      //expect(keys.length).toBeGreaterThanOrEqual(2);
      //if (keys.length < 2) throw new Error("Invalid keys");
      const topup: AccountKey = Object.assign(Local.testAccounts[0], {
        key: Local.testAccounts[0].key,
        name: "topup",
      });
      await topupAccounts({
        accounts: [sender, user, buyer, admin, feeMaster],
        sender: topup,
        amountInMina: 100,
        chain: "local",
      });
      console.log("test accounts", Local.testAccounts.length);
      let txTopup = await Mina.transaction(
        {
          sender: topup,
          fee: 100_000_000,
          memo: `topup 2`,
        },
        async () => {
          for (let index = 1; index < Local.testAccounts.length; index++) {
            const accountUpdate = AccountUpdate.create(
              Local.testAccounts[index]
            );
            accountUpdate.requireSignature();
            accountUpdate.send({
              to: admin,
              amount: UInt64.from(1000_000_000_000),
            });
          }
        }
      );
      txTopup.sign(Local.testAccounts.map((account) => account.key));
      await sendTx({
        tx: txTopup,
        wait: true,
        description: "topup 2",
        chain: "local",
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
          name: "FungibleTokenBondingCurveAdmin",
          result: await FungibleTokenBondingCurveAdmin.analyzeMethods(),
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
      adminVerificationKey = (
        await FungibleTokenBondingCurveAdmin.compile({ cache })
      ).verificationKey;
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

      await fetchMinaAccount({ publicKey: admin, force: true });
      const balance = await accountBalanceMina(admin);
      console.log("Admin balance:", balance);
      if (balance < 20) throw new Error("Insufficient balance of sender");

      const tx = await Mina.transaction(
        { sender: admin, fee: await fee(), memo: "deploy" },
        async () => {
          await adminContract.deploy({});
          adminContract.account.zkappUri.set("BondingCurveAdmin");
          adminContract.account.tokenSymbol.set("BC");
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
          await adminContract.initialize({
            tokenAddress: tokenContractKey,
            startPrice: UInt64.from(10_000),
            curveK: UInt64.from(10_000),
            feeMaster,
            fee: UInt32.from(1000), // 1000 = 1%
            launchFee: UInt64.from(10_000_000_000),
            numberOfNewAccounts: UInt64.from(4),
          });
        }
      );
      await tx.prove();
      tx.sign([admin.key, tokenContractKey.key, adminContractKey.key]);
      await sendTx({ tx, description: "deploy", chain: "local" });
    });
  }

  if (mint) {
    it(`should mint tokens by admin`, async () => {
      await printBalances({
        accounts: [admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });

      await fetchMinaAccount({ publicKey: admin, force: true });
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
      console.time("build tx");
      const mint = await Mina.transaction(
        {
          sender: admin,
          fee: 100_000_000,
          memo: "mint by admin",
        },
        async () => {
          await adminContract.mint(
            admin,
            UInt64.from(1_000_000_000_000_000),
            UInt64.from(10_000)
          );
        }
      );
      console.timeEnd("build tx");
      console.time("prove tx");
      await mint.prove();
      console.timeEnd("prove tx");
      console.time("sign tx");
      mint.sign([admin.key]);
      console.timeEnd("sign tx");
      console.time("send tx");
      await sendTx({
        tx: mint,
        description: `mint by admin`,
        chain: "local",
      });
      console.timeEnd("send tx");
      await printBalances({
        accounts: [admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });
      await printBalances({
        accounts: [admin, adminContractKey],
        tokenId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [adminContractKey],
        tokenId: adminTokenId,
        tokenName: "ADMIN",
      });
    });
    it(`should mint tokens by admin`, async () => {
      await printBalances({
        accounts: [admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });

      await fetchMinaAccount({ publicKey: admin, force: true });
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
      Memory.info("before transfer tx build");
      console.time("build tx");
      const mint = await Mina.transaction(
        {
          sender: admin,
          fee: 100_000_000 * NUMBER_OF_TRANSFERS,
          memo: "transfer by admin",
        },
        async () => {
          AccountUpdate.fundNewAccount(admin, NUMBER_OF_TRANSFERS);
          for (let i = 0; i < NUMBER_OF_TRANSFERS; i++) {
            const user = PrivateKey.random().toPublicKey();
            await tokenContract.transfer(
              admin,
              user,
              UInt64.from(1_000_000_000)
            );
          }
        }
      );
      console.timeEnd("build tx");
      Memory.info("before transfer tx prove");
      console.time("prove tx");
      await mint.prove();
      console.timeEnd("prove tx");
      Memory.info("before transfer tx sign");
      console.time("sign tx");
      mint.sign([admin.key]);
      console.timeEnd("sign tx");
      Memory.info("before transfer tx send");
      console.time("send tx");
      await sendTx({
        tx: mint,
        description: `transfer by admin: ${NUMBER_OF_TRANSFERS} users`,
        chain: "local",
      });
      console.timeEnd("send tx");
      Memory.info("after transfer tx send");
      await printBalances({
        accounts: [admin, adminContractKey, feeMaster],
        tokenName: "MINA",
      });
      await printBalances({
        accounts: [admin, adminContractKey],
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
