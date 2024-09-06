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
} from "o1js";
import { FungibleToken } from "./FungibleToken";
import { BidContract } from "./bid";

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

  @method async settle(bid: PublicKey, buyer: PublicKey) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const price = this.price.getAndRequireEquals();
    const bidContract = new BidContract(bid);

    let receiver = this.send({ to: buyer, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);

    await bidContract.settle(owner, receiver, price);
  }
}
