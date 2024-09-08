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

export class OptionOffer extends SmartContract {
  @state(PublicKey) owner = State<PublicKey>(PublicKey.empty());
  @state(UInt64) amount = State<UInt64>(UInt64.from(0));
  @state(PublicKey) baseToken = State<PublicKey>(PublicKey.empty());
  @state(PublicKey) optionOwner = State<PublicKey>(PublicKey.empty());
  @state(UInt64) optionPrice = State<UInt64>(UInt64.from(0));

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

  @method async offer(
    token: PublicKey,
    baseToken: PublicKey,
    amount: UInt64,
    optionPrice: UInt64
  ) {
    // TODO: add expiration date
    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);

    this.amount.set(amount);
    this.owner.set(sender);
    this.baseToken.set(baseToken);
    this.optionPrice.set(optionPrice);
    this.optionOwner.set(PublicKey.empty());

    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    await tokenContract.transfer(sender, this.address, amount);
  }

  @method async acceptOptionOffer() {
    // TODO: check expiration date
    const optionPrice = this.optionPrice.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();

    const buyer = this.sender.getUnconstrained();
    const update = AccountUpdate.createSigned(buyer);
    const receiver = update.send({ to: owner, amount: optionPrice });
    receiver.body.useFullCommitment = Bool(true);
    update.body.useFullCommitment = Bool(true);
    this.optionOwner.set(buyer);
  }

  @method async executeOption() {
    // TODO: add expiration date
    // TODO: add whitelist option
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const baseToken = this.baseToken.getAndRequireEquals();

    const baseTokenContract = new FungibleToken(baseToken);

    const buyer = this.sender.getAndRequireSignature();
    buyer.assertEquals(this.optionOwner.getAndRequireEquals());
    await baseTokenContract.transfer(buyer, owner, amount);

    const receiver = this.send({ to: buyer, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);
  }

  @method async withdraw() {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    const optionOwner = this.optionOwner.getAndRequireEquals();
    sender.assertEquals(owner);
    optionOwner.equals(PublicKey.empty()).assertFalse();

    let receiver = this.send({ to: owner, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);
  }
}
