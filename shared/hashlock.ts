import { hexlify, keccak256, randomBytes } from "ethers";

export interface HashlockMaterial {
  preimage: string;
  hashlock: string;
}

export function createHashlockMaterial(): HashlockMaterial {
  const preimage = hexlify(randomBytes(32));
  return { preimage, hashlock: keccak256(preimage) };
}
