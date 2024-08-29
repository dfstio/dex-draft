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
  Field,
} from "o1js";
import { FungibleToken } from "./FungibleToken";
import { OfferContract } from "./offer";

export class BidContract extends SmartContract {
  @state(UInt64) price = State<UInt64>(UInt64.from(0));
  @state(UInt64) amount = State<UInt64>(UInt64.from(0));
  @state(PublicKey) owner = State<PublicKey>(PublicKey.empty());
  @state(PublicKey) token = State<PublicKey>(PublicKey.empty());

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

  @method async bid(token: PublicKey, amount: UInt64, price: UInt64) {
    this.price.getAndRequireEquals().assertEquals(UInt64.from(0));
    this.owner.getAndRequireEquals().assertEquals(PublicKey.empty());
    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.send({ to: this.address, amount: price });
    senderUpdate.body.useFullCommitment = Bool(true);

    this.price.set(price);
    this.amount.set(amount);
    this.owner.set(sender);
    this.token.set(token);
  }

  @method async sell(seller: PublicKey) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const price = this.price.getAndRequireEquals();
    const token = this.token.getAndRequireEquals();

    //const sender = this.sender.getUnconstrained();
    //const senderUpdate = AccountUpdate.createSigned(sender);
    //senderUpdate.body.useFullCommitment = Bool(true);

    /*
    this.account.balance
      .getAndRequireEquals()
      .assertGreaterThanOrEqual(price, "Not enough balance to sell");
      */
    let receiverAU = this.send({ to: seller, amount: price });
    receiverAU.body.useFullCommitment = Bool(true);

    const tokenContract = new FungibleToken(token);
    await tokenContract.transfer(seller, owner, amount);

    this.price.set(UInt64.from(0));
    this.amount.set(UInt64.from(0));
    this.owner.set(PublicKey.empty());
    this.token.set(PublicKey.empty());
  }

  @method async settle(offerContractAddress: PublicKey, tokenId: Field) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const price = this.price.getAndRequireEquals();
    const token = this.token.getAndRequireEquals();

    //const tokenContract = new FungibleToken(token);
    //const tokenId = tokenContract.deriveTokenId();
    const offerContract = new OfferContract(offerContractAddress, tokenId);
    const seller = await offerContract.settle(owner, this.address);
    let receiverAU = this.send({ to: seller, amount: price });
    receiverAU.body.useFullCommitment = Bool(true);
    //this.self.approve(bidUpdate);

    //this.price.set(UInt64.from(0));
    //this.amount.set(UInt64.from(0));
    //this.owner.set(PublicKey.empty());
    //this.token.set(PublicKey.empty());
  }
}
