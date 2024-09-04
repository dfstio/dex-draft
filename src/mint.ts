import { Mina, AccountUpdate, UInt64, PublicKey } from "o1js";
import { fetchMinaAccount, fee, accountBalanceMina } from "zkcloudworker";
import { FungibleToken } from "./FungibleToken";
import { AccountKey } from "./key";
import { sendTx } from "./send";

export async function mint(params: {
  account: PublicKey;
  sender: AccountKey;
  adminKey: AccountKey;
  adminContractKey: PublicKey;
  tokenContractKey: PublicKey;
}) {
  const { account, sender, adminKey, adminContractKey, tokenContractKey } =
    params;
  const tokenContract = new FungibleToken(tokenContractKey);
  const tokenId = tokenContract.deriveTokenId();
  await fetchMinaAccount({ publicKey: sender, force: true });
  await fetchMinaAccount({ publicKey: account, tokenId, force: false });
  await fetchMinaAccount({ publicKey: adminContractKey, force: true });
  await fetchMinaAccount({ publicKey: tokenContractKey, force: true });
  await fetchMinaAccount({ publicKey: tokenContractKey, tokenId, force: true });
  await fetchMinaAccount({ publicKey: adminKey, force: true });

  const balance = await accountBalanceMina(sender);
  console.log("Sender balance:", balance);
  if (balance < 2) throw new Error("Insufficient balance of sender");
  const isExistingAccount = Mina.hasAccount(account, tokenId);

  const mintTx = await Mina.transaction(
    {
      sender,
      fee: await fee(),
    },
    async () => {
      if (!isExistingAccount) AccountUpdate.fundNewAccount(sender, 1);
      await tokenContract.mint(account, new UInt64(1000e9));
    }
  );
  await mintTx.prove();
  mintTx.sign([sender.key, adminKey.key]);
  await sendTx(mintTx, "mint");
}
