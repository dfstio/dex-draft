import { AccountKey } from "./key";
import { Field, Mina } from "o1js";
import { fetchMinaAccount } from "zkcloudworker";

export async function printBalances(params: {
  accounts: AccountKey[];
  tokenId?: Field;
  tokenName?: string;
}) {
  const { accounts, tokenId, tokenName } = params;
  for (const account of accounts) {
    await fetchMinaAccount({
      publicKey: account,
      tokenId,
      force: false,
    });
    const balance = Mina.getBalance(account, tokenId);
    console.log(
      `The balance of ${account.name ?? account.toBase58()} is: ${
        balance.toBigInt() / 1_000_000_000n
      } ${tokenId ? tokenName ?? "tokens" : "MINA"}`
    );
  }
}
