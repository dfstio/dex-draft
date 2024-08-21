import {
  zkCloudWorker,
  Cloud,
  fee,
  sleep,
  fetchMinaAccount,
  accountBalanceMina,
} from "zkcloudworker";
import {
  VerificationKey,
  PublicKey,
  Mina,
  PrivateKey,
  AccountUpdate,
  Cache,
  UInt64,
} from "o1js";
import { FungibleToken } from "./FungibleToken";

export class TokenWorker extends zkCloudWorker {
  static contractVerificationKey: VerificationKey | undefined = undefined;
  readonly cache: Cache;

  constructor(cloud: Cloud) {
    super(cloud);
    this.cache = Cache.FileSystem(this.cloud.cache);
  }

  private async compile(compileSmartContracts: boolean = true): Promise<void> {
    try {
      console.time("compiled");

      if (TokenWorker.contractVerificationKey === undefined) {
        console.time("compiled FungibleToken");
        TokenWorker.contractVerificationKey = (
          await FungibleToken.compile({
            cache: this.cache,
          })
        ).verificationKey;
        console.timeEnd("compiled FungibleToken");
      }
      console.timeEnd("compiled");
    } catch (error) {
      console.error("Error in compile, restarting container", error);
      // Restarting the container, see https://github.com/o1-labs/o1js/issues/1651
      await this.cloud.forceWorkerRestart();
      throw error;
    }
  }

  public async create(transaction: string): Promise<string | undefined> {
    throw new Error("Method not implemented.");
  }

  public async merge(
    proof1: string,
    proof2: string
  ): Promise<string | undefined> {
    throw new Error("Method not implemented.");
  }

  public async execute(transactions: string[]): Promise<string | undefined> {
    if (this.cloud.args === undefined)
      throw new Error("this.cloud.args is undefined");
    const args = JSON.parse(this.cloud.args);
    //console.log("args", args);
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");

    switch (this.cloud.task) {
      case "send":
        return await this.sendTx({ ...args, isMany: false });

      default:
        throw new Error(`Unknown task: ${this.cloud.task}`);
    }
  }

  private async sendTx(args: {
    amount: number;
    contractAddress: string;
    from: string;
    to: string;
  }): Promise<string> {
    if (args.amount === undefined) throw new Error("args.amount is undefined");
    if (args.contractAddress === undefined)
      throw new Error("args.contractAddress is undefined");
    if (args.from === undefined) throw new Error("args.from is undefined");
    if (args.to === undefined) throw new Error("args.to is undefined");

    const privateKey = PrivateKey.fromBase58(args.from);
    const sender = privateKey.toPublicKey();
    console.log("Sender", sender.toBase58());
    const receiver = PublicKey.fromBase58(args.to);
    console.log("Receiver", receiver.toBase58());
    const contractAddress = PublicKey.fromBase58(args.contractAddress);
    console.log("Contract", contractAddress.toBase58());
    const amount = UInt64.from(args.amount);
    console.log("Amount", amount.toBigInt().toString());
    const zkApp = new FungibleToken(contractAddress);

    console.log(`Sending tx...`);
    console.time("prepared tx");
    const memo = "send token";
    const tokenId = zkApp.deriveTokenId();

    await fetchMinaAccount({
      publicKey: contractAddress,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: sender,
      force: true,
    });
    await fetchMinaAccount({
      publicKey: sender,
      tokenId,
      force: true,
    });

    await fetchMinaAccount({
      publicKey: receiver,
      tokenId,
      force: false,
    });

    const isNewAccount = Mina.hasAccount(receiver, tokenId) ? false : true;
    if (!Mina.hasAccount(contractAddress)) {
      console.error("Contract does not have account");
      return "Contract does not have account";
    }
    if (!Mina.hasAccount(sender, tokenId)) {
      console.error("Sender does not have account for this token");
      return "Sender does not have account for this token";
    }
    if (!Mina.hasAccount(sender)) {
      console.error("Sender does not have account");
      return "Sender does not have account";
    }

    console.log("Sender balance:", await accountBalanceMina(sender));
    await this.compile();
    const tx = await Mina.transaction(
      {
        sender,
        memo,
        fee: await fee(),
      },
      async () => {
        if (isNewAccount) {
          AccountUpdate.fundNewAccount(sender);
        }
        await zkApp.transfer(sender, receiver, amount);
      }
    );

    if (tx === undefined) throw new Error("tx is undefined");
    tx.sign([privateKey]);
    try {
      console.time("proved tx");
      await tx.prove();
      console.timeEnd("proved tx");
      console.timeEnd("prepared tx");
      let txSent;
      let sent = false;
      while (!sent) {
        txSent = await tx.safeSend();
        if (txSent.status == "pending") {
          sent = true;
          console.log(
            `${memo} tx sent: hash: ${txSent.hash} status: ${txSent.status}`
          );
        } else if (this.cloud.chain === "zeko") {
          console.log("Retrying Zeko tx");
          await sleep(10000);
        } else {
          console.log(
            `${memo} tx NOT sent: hash: ${txSent?.hash} status: ${txSent?.status}`
          );
          return "Error sending transaction";
        }
      }
      if (this.cloud.isLocalCloud && txSent?.status === "pending") {
        const txIncluded = await txSent.safeWait();
        console.log(
          `one tx included into block: hash: ${txIncluded.hash} status: ${txIncluded.status}`
        );
        return txIncluded.hash;
      }
      if (txSent?.hash)
        this.cloud.publishTransactionMetadata({
          txId: txSent?.hash,
          metadata: {
            sender: sender.toBase58(),
            receiver: receiver.toBase58(),
            amount: amount.toBigInt().toString(),
            contractAddress: contractAddress.toBase58(),
          } as any,
        });
      return txSent?.hash ?? "Error sending transaction";
    } catch (error) {
      console.error("Error sending transaction", error);
      return "Error sending transaction";
    }
  }
}
