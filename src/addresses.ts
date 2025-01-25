import { AccountKey, getAccountKeys } from "./key";
import { USERS_PRIVATE_KEYS, CONTRACTS_PRIVATE_KEYS } from "../env.json";
import { PrivateKey } from "o1js";

export function getAccounts(): {
  sender: AccountKey;
  user: AccountKey;
  buyer: AccountKey;
  admin: AccountKey;
  adminA: AccountKey;
  adminB: AccountKey;
  userA: AccountKey;
  userB: AccountKey;
  bot: AccountKey;
  feeMaster: AccountKey;
  tokenContractKey: AccountKey;
  adminContractKey: AccountKey;
  offerContractKey: AccountKey;
  bidContractKey: AccountKey;
  tokenAKey: AccountKey;
  tokenBKey: AccountKey;
  adminAKey: AccountKey;
  adminBKey: AccountKey;
  swapAKey: AccountKey;
  swapBKey: AccountKey;
  optionOfferKey: AccountKey;
} {
  const [
    sender,
    user,
    buyer,
    admin,
    adminA,
    adminB,
    userA,
    userB,
    bot,
    feeMaster,
  ] = getAccountKeys({
    names: [
      "sender",
      "user",
      "buyer",
      "admin",
      "adminA",
      "adminB",
      "userA",
      "userB",
      "bot",
      "feeMaster",
    ],
    privateKeys: USERS_PRIVATE_KEYS,
  });

  const [
    tokenContractKey,
    adminContractKey,
    offerContractKey,
    bidContractKey,
    tokenAKey,
    tokenBKey,
    adminAKey,
    adminBKey,
    swapAKey,
    swapBKey,
    optionOfferKey,
  ] = getAccountKeys({
    names: [
      "tokenContract",
      "adminContract",
      "offerContract",
      "bidContract",
      "tokenA",
      "tokenB",
      "adminA",
      "adminB",
      "swapA",
      "swapB",
      "option",
    ],
    privateKeys: Array(15)
      .fill("")
      .map((_) => PrivateKey.random().toBase58()),
    //CONTRACTS_PRIVATE_KEYS,
  });
  return {
    sender,
    user,
    buyer,
    admin,
    adminA,
    adminB,
    userA,
    userB,
    bot,
    feeMaster,
    tokenContractKey,
    adminContractKey,
    offerContractKey,
    bidContractKey,
    tokenAKey,
    tokenBKey,
    adminAKey,
    adminBKey,
    swapAKey,
    swapBKey,
    optionOfferKey,
  };
}
