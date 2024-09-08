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
} from "zkcloudworker";
import { zkcloudworker } from "..";
import { FungibleToken, setDebug } from "../src/FungibleToken";
import { FungibleTokenAdmin } from "../src/FungibleTokenAdmin";
import { OptionOffer } from "../src/option";
import { sendTx, useChain } from "../src/send";
import { AccountKey, topupAccounts } from "../src/key";
import { getAccounts } from "../src/addresses";
import { printAddresses, printBalances } from "../src/print";
import { deployToken } from "../src/deploy";
import { mint } from "../src/mint";

setNumberOfWorkers(8);

const {
  chain,
  compile,
  deploy,
  debugAU,
  mint: shouldMint,
} = processArguments();
setDebug(debugAU);
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
  optionOfferKey,
} = getAccounts();

const tokenA = new FungibleToken(tokenAKey);
const tokenAId = tokenA.deriveTokenId();
const tokenB = new FungibleToken(tokenBKey);
const tokenBId = tokenB.deriveTokenId();
const adminAContract = new FungibleTokenAdmin(adminAKey);
const adminBContract = new FungibleTokenAdmin(adminBKey);
const option = new OptionOffer(optionOfferKey, tokenAId);
let contractVerificationKey: VerificationKey;
let adminVerificationKey: VerificationKey;
let optionVerificationKey: VerificationKey;
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
      optionOfferKey,
    ]);
    console.log("tokenId A:", tokenAId.toJSON());
    console.log("tokenId B:", tokenBId.toJSON());
    await printBalances({
      accounts: [sender, userA, userB, adminA, adminB],
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
          name: "OptionOffer",
          result: await OptionOffer.analyzeMethods(),
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

      console.time("OptionOffer compiled");
      optionVerificationKey = (await OptionOffer.compile({ cache }))
        .verificationKey;
      console.timeEnd("OptionOffer compiled");

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
        "OptionOffer verification key",
        optionVerificationKey.hash.toJSON()
      );
      Memory.info("compiled");
    });
  }
  if (deploy) {
    it(`should deploy contract`, async () => {
      expect(blockchainInitialized).toBe(true);
      if (shouldMint) {
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
      }

      await fetchMinaAccount({ publicKey: sender, force: true });
      await fetchMinaAccount({ publicKey: tokenAKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenAKey,
        tokenId: tokenAId,
        force: true,
      });
      const optionDeploy = await Mina.transaction(
        { sender, fee: await fee(), memo: "option deploy" },
        async () => {
          AccountUpdate.fundNewAccount(sender, 1);
          await option.deploy({});
          await tokenA.approveAccountUpdate(option.self);
        }
      );
      await optionDeploy.prove();
      optionDeploy.sign([sender.key, optionOfferKey.key]);
      await sendTx(optionDeploy, "option deploy");

      Memory.info("deployed");
      await printBalances({
        accounts: [userA, userB, optionOfferKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });
      await printBalances({
        accounts: [userA, userB],
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
        publicKey: optionOfferKey,
        tokenId: tokenAId,
        force: true,
      });

      const offerATx = await Mina.transaction(
        {
          sender: userA,
          fee: await fee(),
          memo: "option offer A",
        },
        async () => {
          await option.offer(
            tokenAKey,
            tokenBKey,
            UInt64.from(10e9),
            UInt64.from(20e9)
          );
          await tokenA.approveAccountUpdate(option.self);
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
        accounts: [userA, userB, optionOfferKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });
      await printBalances({
        accounts: [userA, userB],
      });

      console.log("Preparing offer accept tx");
      await fetchMinaAccount({ publicKey: userB, force: true });
      await fetchMinaAccount({ publicKey: userA, force: true });
      await fetchMinaAccount({ publicKey: tokenAKey, force: true });
      await fetchMinaAccount({
        publicKey: tokenAKey,
        tokenId: tokenAId,
        force: true,
      });
      await fetchMinaAccount({
        publicKey: optionOfferKey,
        tokenId: tokenAId,
        force: true,
      });

      const offerAcceptTx = await Mina.transaction(
        {
          sender: userB,
          fee: await fee(),
          memo: "option accept",
        },
        async () => {
          await option.acceptOptionOffer();
          await tokenA.approveAccountUpdate(option.self);
        }
      );
      await offerAcceptTx.prove();
      offerAcceptTx.sign([userB.key]);
      console.log(
        "Offer accept tx au:",
        JSON.parse(offerAcceptTx.toJSON()).accountUpdates.length
      );
      await sendTx(offerAcceptTx, "offer accept");
      await printBalances({
        accounts: [userA, userB, optionOfferKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });
      await printBalances({
        accounts: [userA, userB],
      });

      console.log("Preparing offer execute tx");
      await fetchMinaAccount({ publicKey: userB, force: true });
      await fetchMinaAccount({
        publicKey: optionOfferKey,
        tokenId: tokenAId,
        force: true,
      });
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

      const offerExecuteTx = await Mina.transaction(
        {
          sender: userB,
          fee: await fee(),
          memo: "option execute",
        },
        async () => {
          await option.executeOption();
          await tokenA.approveAccountUpdate(option.self);
        }
      );
      await offerExecuteTx.prove();
      offerExecuteTx.sign([userB.key]);
      console.log(
        "Offer execute tx au:",
        JSON.parse(offerExecuteTx.toJSON()).accountUpdates.length
      );
      await sendTx(offerExecuteTx, "offer execute");
      await printBalances({
        accounts: [userA, userB, optionOfferKey],
        tokenId: tokenAId,
        tokenName: "TEST_A",
      });
      await printBalances({
        accounts: [userA, userB],
        tokenId: tokenBId,
        tokenName: "TEST_B",
      });
      await printBalances({
        accounts: [userA, userB],
      });
    });
  }
});

function processArguments(): {
  chain: blockchain;
  compile: boolean;
  deploy: boolean;
  debugAU: boolean;
  mint: boolean;
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
  const shouldDebug = getArgument("debugAU") ?? "false";
  const shouldMint = getArgument("mint") ?? "true";
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
    debugAU: shouldDebug === "true",
    mint: shouldMint === "true",
    useLocalCloudWorker: cloud
      ? cloud === "local"
      : chainName === "local" || chainName === "lightnet",
  };
}
