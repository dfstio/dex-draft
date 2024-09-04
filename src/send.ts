import { Mina } from "o1js";
import { blockchain, sleep } from "zkcloudworker";

let usedChain: blockchain | undefined = undefined;

export function useChain(chain: blockchain) {
  usedChain = chain;
}

export async function sendTx(
  tx: Mina.Transaction<false, true> | Mina.Transaction<true, true>,
  description: string = "",
  wait: boolean = true,
  chain: blockchain | undefined = undefined
) {
  chain = chain ?? usedChain ?? "local";
  try {
    let txSent;
    let sent = false;
    while (!sent) {
      txSent = await tx.safeSend();
      if (txSent.status == "pending") {
        sent = true;
        console.log(
          `${description ?? ""} tx sent: hash: ${txSent.hash} status: ${
            txSent.status
          }`
        );
      } else if (chain === "zeko") {
        console.log("Retrying Zeko tx");
        await sleep(10000);
      } else {
        console.log(
          `${description ?? ""} tx NOT sent: hash: ${txSent?.hash} status: ${
            txSent?.status
          }`,
          txSent?.errors
        );
        return "Error sending transaction";
      }
    }
    if (txSent === undefined) throw new Error("txSent is undefined");
    if (txSent.errors.length > 0) {
      console.error(
        `${description ?? ""} tx error: hash: ${txSent.hash} status: ${
          txSent.status
        }  errors: ${txSent.errors}`
      );
    }

    if (txSent.status === "pending" && wait) {
      console.log(`Waiting for tx inclusion...`);
      const txIncluded = await txSent.safeWait();
      console.log(
        `${description ?? ""} tx included into block: hash: ${
          txIncluded.hash
        } status: ${txIncluded.status}`
      );
    }
  } catch (error) {
    if (chain !== "zeko") console.error("Error sending tx", error);
  }
  if (chain !== "local") await sleep(10000);
}
