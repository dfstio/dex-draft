import { PublicKey, PrivateKey, Mina, AccountUpdate } from "o1js";
import { accountBalanceMina, fetchMinaAccount, fee } from "zkcloudworker";
import { sendTx } from "./send";

export type AccountKey = PublicKey & {
  key: PrivateKey;
  name?: string;
};

export function getAccountKeys(params: {
  names?: string[];
  privateKeys?: string[];
  publicKeys?: string[];
}): AccountKey[] {
  try {
    const { names = [], privateKeys = [], publicKeys = [] } = params;
    const length = Math.max(
      names.length,
      privateKeys.length,
      publicKeys.length
    );
    const keys: AccountKey[] = [];
    for (let i = 0; i < length; i++) {
      const name = i < names.length ? names[i] : undefined;
      let privateKey =
        i < privateKeys.length
          ? privateKeys[i] === ""
            ? undefined
            : PrivateKey.fromBase58(privateKeys[i])
          : undefined;
      let publicKey =
        i < publicKeys.length
          ? publicKeys[i] === ""
            ? undefined
            : PublicKey.fromBase58(publicKeys[i])
          : undefined;
      if (
        publicKey &&
        privateKey &&
        publicKey.toBase58() !== privateKey.toPublicKey().toBase58()
      ) {
        throw new Error(
          `Public key and private key do not match for account No ${i} ${
            name ?? ""
          }`
        );
      }
      if (!publicKey && privateKey) {
        publicKey = privateKey.toPublicKey();
      } else if (!publicKey && !privateKey) {
        privateKey = PrivateKey.random();
        publicKey = privateKey.toPublicKey();
      }
      if (!publicKey) {
        throw new Error(`Public key missing for account No ${i} ${name ?? ""}`);
      }
      keys.push(
        Object.assign(publicKey, {
          key: privateKey ?? PrivateKey.empty(),
          name,
        })
      );
    }
    return keys;
  } catch (e) {
    console.error("getAccountKeys", e);
    return [];
  }
}

export async function topupAccounts(params: {
  accounts: PublicKey[];
  sender: AccountKey;
  amountInMina: number; // MINA
}) {
  const { accounts, sender, amountInMina } = params;
  const amount = amountInMina * 1e9;
  await fetchMinaAccount({ publicKey: sender, force: true });
  let nonce = Number(Mina.getAccount(sender).nonce.toBigint());
  for (let i = 0; i < accounts.length; i++) {
    const to = accounts[i];
    await fetchMinaAccount({ publicKey: to, force: false });
    if (!Mina.hasAccount(to)) {
      const topupTx = await Mina.transaction(
        {
          sender,
          fee: await fee(),
          nonce: nonce++,
        },
        async () => {
          const senderUpdate = AccountUpdate.createSigned(sender);
          senderUpdate.balance.subInPlace(1000000000);
          senderUpdate.send({ to, amount });
        }
      );
      topupTx.sign([sender.key]);
      await sendTx(
        topupTx,
        `topup ${to.toBase58()}`,
        i === accounts.length - 1
      );
    }
  }
}
