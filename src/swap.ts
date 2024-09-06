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
  Provable,
} from "o1js";
import { FungibleToken } from "./FungibleToken";

export class SwapContract extends SmartContract {
  @state(UInt64) amount = State<UInt64>(UInt64.from(0));
  @state(PublicKey) owner = State<PublicKey>(PublicKey.empty());
  @state(PublicKey) baseToken = State<PublicKey>(PublicKey.empty());

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
    this.owner.getAndRequireEquals().assertEquals(PublicKey.empty());
    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);

    this.amount.set(amount);
    this.owner.set(sender);
    this.baseToken.set(baseToken);

    const tokenContract = new FungibleToken(token);
    const tokenId = tokenContract.deriveTokenId();
    tokenId.assertEquals(this.tokenId);
    await tokenContract.transfer(sender, this.address, amount);
  }

  @method async settle(
    //.returns(AccountUpdate)
    token: PublicKey,
    baseToken: PublicKey,
    baseSwap: PublicKey,
    baseTokenId: Field,
    baseOwner: PublicKey
  ) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    //const baseToken = this.baseToken.getAndRequireEquals();
    //const tokenContract = new FungibleToken(token);

    let receiver = this.send({ to: baseOwner, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);

    const baseTokenContract = new FungibleToken(baseToken);
    const baseSwapContract = new SwapContract(baseSwap, baseTokenId);
    await baseSwapContract.baseSettle(owner, amount);

    Provable.log("Approving swap account update", baseSwapContract.self);
    await baseTokenContract.approveAccountUpdate(baseSwapContract.self);
  }

  @method async baseSettle(owner: PublicKey, amount: UInt64) {
    //this.approvedTransfer.getAndRequireEquals().assertEquals(Bool(true));
    const baseAmount = this.amount.getAndRequireEquals();
    //const baseOwner = this.owner.getAndRequireEquals();
    //const token = this.baseToken.getAndRequireEquals();
    amount.assertEquals(baseAmount);
    const sender = this.send({ to: owner, amount });
    sender.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    sender.body.useFullCommitment = Bool(true);
  }

  /*
  @method async approveTransfer(
    receiver: AccountUpdate,
    owner: PublicKey,
    amount: UInt64
  ) {
    const baseAmount = this.amount.getAndRequireEquals();
    receiver.balanceChange.assertEquals(baseAmount);
    this.approve(receiver);
    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    //await this.baseSettle(owner, amount);
  }
    */
}

/*

  @method async settle(
    //.returns(AccountUpdate)
    token: PublicKey,
    baseToken: PublicKey,
    baseSwap: PublicKey,
    baseTokenId: Field,
    baseOwner: PublicKey
  ) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();
    //const baseToken = this.baseToken.getAndRequireEquals();
    //const tokenContract = new FungibleToken(token);

    let receiver = this.send({ to: baseOwner, amount });
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);

    const baseTokenContract = new FungibleToken(baseToken);
    const baseSwapContract = new SwapContract(baseSwap, baseTokenId);
    await baseSwapContract.baseSettle(owner, amount);

    Provable.log("Approving swap account update", baseSwapContract.self);
    await baseTokenContract.approveAccountUpdate(baseSwapContract.self);
  }

  @method async baseSettle(owner: PublicKey, amount: UInt64) {
    //this.approvedTransfer.getAndRequireEquals().assertEquals(Bool(true));
    const baseAmount = this.amount.getAndRequireEquals();
    //const baseOwner = this.owner.getAndRequireEquals();
    //const token = this.baseToken.getAndRequireEquals();
    amount.assertEquals(baseAmount);
    const sender = this.send({ to: owner, amount });
    sender.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    sender.body.useFullCommitment = Bool(true);
  }

  */
