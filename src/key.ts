import { PublicKey, PrivateKey } from "o1js";

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
