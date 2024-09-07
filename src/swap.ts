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
    baseToken: PublicKey,
    baseOwner: PublicKey,
    baseSwapAddress: PublicKey,
    baseTokenId: Field,
    swapSettleAddress: PublicKey
  ) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();

    const baseTokenContract = new FungibleToken(baseToken);
    const tokenId: Field = this.tokenId;
    const swapReceiver: AccountUpdate = AccountUpdate.default(
      baseOwner,
      tokenId
    );
    swapReceiver.label = `swap receive`;
    swapReceiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    swapReceiver.body.useFullCommitment = Bool(true);

    const swap: AccountUpdate = AccountUpdate.default(this.address, tokenId);
    swap.label = `swap send`;
    swap.balanceChange = swap.balanceChange.sub(amount);
    swap.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    swap.body.useFullCommitment = Bool(true);

    swapReceiver.body.balanceChange =
      swapReceiver.body.balanceChange.add(amount);
    swapReceiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;

    this.approve(swap);
    this.approve(swapReceiver);

    const baseSwapReceiver: AccountUpdate = AccountUpdate.default(
      owner,
      baseTokenId
    );
    baseSwapReceiver.label = `base swap receive`;
    baseSwapReceiver.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    baseSwapReceiver.body.useFullCommitment = Bool(true);

    const baseSwap: AccountUpdate = AccountUpdate.default(
      baseSwapAddress,
      baseTokenId
    );
    baseSwap.label = `base swap send`;
    baseSwap.balanceChange = baseSwap.balanceChange.sub(amount);
    baseSwap.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    baseSwap.body.useFullCommitment = Bool(true);

    baseSwapReceiver.body.balanceChange =
      baseSwapReceiver.body.balanceChange.add(amount);
    baseSwapReceiver.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;

    this.approve(baseSwap);
    this.approve(baseSwapReceiver);

    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    Provable.log("Approving swap account update");
    await baseTokenContract.approveAccountUpdates([baseSwap, baseSwapReceiver]);
  }

  /*

    @method async settle(
    baseToken: PublicKey,
    baseOwner: PublicKey,
    baseSwap: PublicKey,
    baseTokenId: Field,
    swapSettleAddress: PublicKey
  ) {
    const amount = this.amount.getAndRequireEquals();
    const owner = this.owner.getAndRequireEquals();

    const baseTokenContract = new FungibleToken(baseToken);
    const swapSettle: SwapSettle = new SwapSettle(swapSettleAddress);
    await swapSettle.swap(
      amount,
      owner,
      this.address,
      this.tokenId,
      baseOwner,
      baseTokenId,
      baseSwap
    );
    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    Provable.log("Approving swap account update", swapSettle.self);
    await baseTokenContract.approveAccountUpdate(swapSettle.self);
  }
  @method async baseSettle(
    amount: UInt64,
    owner: PublicKey,
    tokenId: Field,
    swapAddress: PublicKey,
    swapSettleAddress: PublicKey
  ) {
    const baseAmount = this.amount.getAndRequireEquals();
    const baseOwner = this.owner.getAndRequireEquals();
    amount.assertEquals(baseAmount);
    const swapSettle: SwapSettle = new SwapSettle(swapSettleAddress);
    await swapSettle.swap(
      amount,
      owner,
      swapAddress,
      tokenId,
      baseOwner,
      this.tokenId,
      this.address
    );
    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
  }
    */
}
export class SwapSettle extends SmartContract {
  @state(UInt64) amount = State<UInt64>(UInt64.from(0));

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

  @method async swap(
    amount: UInt64,
    owner: PublicKey,
    swapAddress: PublicKey,
    tokenId: Field,
    baseOwner: PublicKey,
    baseTokenId: Field,
    baseSwapAddress: PublicKey
  ) {
    const swapReceiver: AccountUpdate = AccountUpdate.default(
      baseOwner,
      tokenId
    );
    swapReceiver.label = `swap receive`;
    swapReceiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    swapReceiver.body.useFullCommitment = Bool(true);

    const swap: AccountUpdate = AccountUpdate.default(swapAddress, tokenId);
    swap.label = `swap send`;
    swap.balanceChange = swap.balanceChange.sub(amount);
    swap.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    swap.body.useFullCommitment = Bool(true);

    swapReceiver.body.balanceChange =
      swapReceiver.body.balanceChange.add(amount);
    swapReceiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;

    this.approve(swap);
    this.approve(swapReceiver);

    const baseSwapReceiver: AccountUpdate = AccountUpdate.default(
      owner,
      baseTokenId
    );
    baseSwapReceiver.label = `base swap receive`;
    baseSwapReceiver.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    baseSwapReceiver.body.useFullCommitment = Bool(true);

    const baseSwap: AccountUpdate = AccountUpdate.default(
      baseSwapAddress,
      baseTokenId
    );
    baseSwap.label = `base swap send`;
    baseSwap.balanceChange = baseSwap.balanceChange.sub(amount);
    baseSwap.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    baseSwap.body.useFullCommitment = Bool(true);

    baseSwapReceiver.body.balanceChange =
      baseSwapReceiver.body.balanceChange.add(amount);
    baseSwapReceiver.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;

    this.approve(baseSwap);
    this.approve(baseSwapReceiver);

    this.self.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
  }
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

    //let receiver = this.send({ to: baseOwner, amount });
    const receiver: AccountUpdate = AccountUpdate.default(
      baseOwner,
      this.tokenId
    );
    receiver.label = `settle.send()`;
    this.approve(receiver);

    // Sub the amount from the sender's account
    this.self.balanceChange = this.self.balanceChange.sub(amount);
    // Add the amount to the receiver's account
    receiver.body.balanceChange = receiver.body.balanceChange.add(amount);
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

    @method.returns(AccountUpdate) async baseSettle(
    owner: PublicKey,
    amount: UInt64,
    tokenId: Field,
    swapAddress: PublicKey
  ) {
    //this.approvedTransfer.getAndRequireEquals().assertEquals(Bool(true));
    const baseAmount = this.amount.getAndRequireEquals();
    const baseOwner = this.owner.getAndRequireEquals();
    //const token = this.baseToken.getAndRequireEquals();
    amount.assertEquals(baseAmount);
    const sender = this.send({ to: owner, amount });
    sender.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    sender.body.useFullCommitment = Bool(true);

    const receiver: AccountUpdate = AccountUpdate.default(baseOwner, tokenId);
    receiver.label = `settle.send() receiver`;
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.ParentsOwnToken;
    this.approve(receiver);

    const swap: AccountUpdate = AccountUpdate.default(swapAddress, tokenId);
    swap.label = `settle.send() swap`;

    // Sub the amount from the sender's account
    swap.balanceChange = swap.balanceChange.sub(amount);
    // Add the amount to the receiver's account
    receiver.body.balanceChange = receiver.body.balanceChange.add(amount);
    receiver.body.mayUseToken = AccountUpdate.MayUseToken.InheritFromParent;
    receiver.body.useFullCommitment = Bool(true);
    return swap;
  }
  */
