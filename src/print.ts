import { AccountKey } from "./key";
import { Field, Mina, UInt64 } from "o1js";
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
    const balance = Mina.hasAccount(account, tokenId)
      ? Mina.getBalance(account, tokenId)
      : UInt64.from(0);
    console.log(
      `The balance of ${account.name ?? account.toBase58()}:\t${
        balance.toBigInt() / 1_000_000_000n
      } ${tokenId ? tokenName ?? "tokens" : "MINA"}`
    );
  }
}

export async function printAddresses(accounts: AccountKey[]) {
  for (const account of accounts) {
    console.log(`${account.name}:\t${account.toBase58()}`);
  }
}
