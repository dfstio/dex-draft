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
import { FungibleToken } from "@minatokens/token";

export class SwapOffer extends SmartContract {
  @state(PublicKey) owner = State<PublicKey>(PublicKey.empty());
  @state(UInt64) amount = State<UInt64>(UInt64.from(0));
  @state(PublicKey) baseToken = State<PublicKey>(PublicKey.empty());
  @state(Bool) canOffer = State<Bool>(Bool(true));

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

  @method async offer(token: PublicKey, baseToken: PublicKey, amount: UInt64) {
    this.canOffer.getAndRequireEquals().assertEquals(Bool(true));
    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);

    this.amount.set(amount);
    this.owner.set(sender);
    this.baseToken.set(baseToken);
    this.canOffer.set(Bool(false));

    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    await tokenContract.transfer(sender, this.address, amount);
  }

  @method async accept() {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const baseToken = this.baseToken.getAndRequireEquals();

    const baseTokenContract = new FungibleToken(baseToken);

    const buyer = this.sender.getAndRequireSignature();
    await baseTokenContract.transfer(buyer, owner, amount);

    const receiver = this.send({ to: buyer, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);
  }

  @method async withdraw() {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    const sender = this.sender.getAndRequireSignature();
    sender.assertEquals(owner);

    let receiver = this.send({ to: owner, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);
    this.canOffer.set(Bool(true));
  }
}
