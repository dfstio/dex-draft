import {
  AccountUpdate,
  DeployArgs,
  method,
  Permissions,
  PublicKey,
  State,
  state,
  UInt64,
  SmartContract,
  Bool,
  AccountUpdateForest,
  AccountUpdateTree,
} from "o1js";
import { FungibleToken } from "./FungibleToken";

export class OfferContract extends SmartContract {
  @state(UInt64) price = State<UInt64>(UInt64.from(0));
  @state(UInt64) amount = State<UInt64>(UInt64.from(0));
  @state(PublicKey) owner = State<PublicKey>(PublicKey.empty());

  async deploy(args: DeployArgs) {
    await super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  @method async offer(token: PublicKey, amount: UInt64, price: UInt64) {
    this.price.getAndRequireEquals().assertEquals(UInt64.from(0));
    this.owner.getAndRequireEquals().assertEquals(PublicKey.empty());
    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);

    this.price.set(price);
    this.amount.set(amount);
    this.owner.set(sender);

    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    await tokenContract.transfer(sender, this.address, amount);
  }

  @method.returns(AccountUpdate) async buy(buyer: PublicKey) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const price = this.price.getAndRequireEquals();

    const buyerUpdate = AccountUpdate.createSigned(buyer);
    buyerUpdate.send({ to: owner, amount: price });
    buyerUpdate.body.useFullCommitment = Bool(true);

    let receiverAU = this.send({ to: buyer, amount });
    receiverAU.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiverAU.body.useFullCommitment = Bool(true);

    this.price.set(UInt64.from(0));
    this.amount.set(UInt64.from(0));
    this.owner.set(PublicKey.empty());
    return buyerUpdate;
  }

  @method.returns(AccountUpdateForest) async settle(
    buyer: PublicKey
    //payer: PublicKey
  ) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const price = this.price.getAndRequireEquals();

    /*
    const payerUpdate = AccountUpdate.default(payer);
    payerUpdate.label = `payment from payer for token sale`;
    //this.approve(payerUpdate);
    payerUpdate.body.balanceChange = payerUpdate.body.balanceChange.sub(price);
    payerUpdate.body.useFullCommitment = Bool(true);

    const ownerUpdate = AccountUpdate.default(owner);
    ownerUpdate.label = `payment to owner for token sale`;
    this.approve(ownerUpdate);
    ownerUpdate.body.balanceChange = ownerUpdate.body.balanceChange.add(price);
    ownerUpdate.body.useFullCommitment = Bool(true);
    */
    // payerUpdate.send({ to: owner, amount: price });

    let receiverAU = this.send({ to: buyer, amount });
    //const receiver = AccountUpdate.default(buyer, this.tokenId);
    //receiver.label = `${this.label ?? 'Unlabeled'}.send()`;
    //this.approve(receiver);

    // Sub the amount from the sender's account
    //this.balance.subInPlace(amount);
    //this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    // Add the amount to the receiver's account
    //receiver.body.balanceChange = receiver.body.balanceChange.add(amount);
    receiverAU.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    //receiver.body.useFullCommitment = Bool(true);

    //this.price.set(UInt64.from(0));
    //this.amount.set(UInt64.from(0));
    //this.owner.set(PublicKey.empty());
    const forest: AccountUpdateForest = AccountUpdateForest.empty();
    forest.push(receiverAU);
    forest.push(this.self);
    return forest;
  }
}
