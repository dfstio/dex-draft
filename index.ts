import {
  Cloud,
  zkCloudWorker,
  initBlockchain,
  VerificationData,
  blockchain,
} from "zkcloudworker";
import { initializeBindings } from "o1js";
import { TokenWorker } from "./src/worker";
import packageJson from "./package.json";
import { FungibleToken } from "./src/FungibleToken";

export async function zkcloudworker(cloud: Cloud): Promise<zkCloudWorker> {
  console.log(
    `starting worker example version ${
      packageJson.version ?? "unknown"
    } on chain ${cloud.chain}`
  );
  await initializeBindings();
  await initBlockchain(cloud.chain);
  return new TokenWorker(cloud);
}

export async function verify(chain: blockchain): Promise<VerificationData> {
  if (chain !== "devnet") throw new Error("Unsupported chain");
  return {
    contract: FungibleToken,
    programDependencies: [],
    contractDependencies: [],
    address: "B62qp7MvZUZ31NuysZYm5oqieCqyBdMxfc3HWZ21iKakXwWaepZSgox",
    chain: "devnet",
  } as VerificationData;
}
