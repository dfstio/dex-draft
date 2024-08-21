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
    });
  }

  @method async offer(token: PublicKey, amount: UInt64, price: UInt64) {
    this.price.getAndRequireEquals().assertEquals(UInt64.from(0));
    this.owner.getAndRequireEquals().assertEquals(PublicKey.empty());
    const sender = this.sender.getAndRequireSignature();

    this.price.set(price);
    this.amount.set(amount);
    this.owner.set(sender);

    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    await tokenContract.transfer(sender, this.address, amount);
  }

  @method async buy() {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const price = this.price.getAndRequireEquals();

    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.send({ to: owner, amount: price });

    let receiverAU = this.send({ to: sender, amount });
    receiverAU.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;

    this.price.set(UInt64.from(0));
    this.amount.set(UInt64.from(0));
    this.owner.set(PublicKey.empty());
  }
}
