import { AccountKey, getAccountKeys } from "./key";
import { USERS_PRIVATE_KEYS, CONTRACTS_PRIVATE_KEYS } from "../env.json";

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
  const [sender, user, buyer, admin, adminA, adminB, userA, userB, bot] =
    getAccountKeys({
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
    privateKeys: CONTRACTS_PRIVATE_KEYS,
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
