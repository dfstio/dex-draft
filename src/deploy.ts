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
import { FungibleToken } from "./FungibleToken";
import { FungibleTokenAdmin } from "./FungibleTokenAdmin";
import { AccountKey } from "./key";
import { sendTx } from "./send";

export async function deployToken(params: {
  tokenSymbol: string;
  tokenUri: string;
  adminUri: string;
  sender: AccountKey;
  adminKey: PublicKey;
  adminContractKey: AccountKey;
  tokenContractKey: AccountKey;
}) {
  const {
    tokenSymbol,
    tokenUri,
    adminUri,
    sender,
    adminKey,
    adminContractKey,
    tokenContractKey,
  } = params;
  console.log(`Deploying contract...`);

  await fetchMinaAccount({ publicKey: sender, force: true });

  const adminContract = new FungibleTokenAdmin(adminContractKey);
  const tokenContract = new FungibleToken(tokenContractKey);
  await fetchMinaAccount({ publicKey: sender, force: true });
  const balance = await accountBalanceMina(sender);
  console.log("Sender balance:", balance);
  if (balance < 5) throw new Error("Insufficient balance of sender");

  const tx = await Mina.transaction(
    { sender, fee: await fee(), memo: "deploy" },
    async () => {
      AccountUpdate.fundNewAccount(sender, 3);
      await adminContract.deploy({ adminPublicKey: adminKey });
      adminContract.account.zkappUri.set(adminUri);
      await tokenContract.deploy({
        symbol: tokenSymbol,
        src: tokenUri,
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
  await sendTx(tx, "deploy");
}
