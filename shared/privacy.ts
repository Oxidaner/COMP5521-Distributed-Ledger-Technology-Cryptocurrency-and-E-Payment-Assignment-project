import { bn254 } from "@noble/curves/bn254";
import { AbiCoder, MaxUint256, ZeroAddress, getAddress, hexlify, id, isHexString, keccak256, parseEther, randomBytes, toBeHex } from "ethers";

const Point = bn254.G1.ProjectivePoint;
export const SCALAR_ORDER = bn254.params.r;
export interface LockPoint { x: string; y: string }
export interface PrivateConfiguration { mst: string; privateMstHtlc: string; privateEthHtlc: string }
export interface PrivatePlan extends PrivateConfiguration {
  version: "point-lock-v1";
  alice: string; bob: string; mstAmount: string; ethAmount: string;
  mstSwapId: string; ethSwapId: string; mstTimelock: number; ethTimelock: number;
  mstPoint: LockPoint; ethPoint: LockPoint; offsetPoint: LockPoint;
  proof: { commitment: LockPoint; response: string };
  mstLockTx?: string; ethLockTx?: string;
}

function scalar(value: unknown, allowZero = false): bigint {
  if (typeof value !== "string" || !isHexString(value, 32)) throw new Error("Invalid private scalar");
  const n = BigInt(value);
  if (n >= SCALAR_ORDER || (!allowZero && n === 0n)) throw new Error("Invalid private scalar");
  return n;
}
function randomScalar(): bigint {
  for (;;) {
    const n = BigInt(hexlify(randomBytes(32)));
    if (n > 0n && n < SCALAR_ORDER) return n;
  }
}
function point(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid lock point");
  const p = value as LockPoint;
  if (typeof p.x !== "string" || typeof p.y !== "string" || !isHexString(p.x, 32) || !isHexString(p.y, 32)) throw new Error("Invalid lock point");
  const result = Point.fromAffine({ x: BigInt(p.x), y: BigInt(p.y) });
  result.assertValidity();
  if (result.equals(Point.ZERO)) throw new Error("Identity lock point is forbidden");
  return result;
}
function encode(p: InstanceType<typeof Point>): LockPoint {
  const { x, y } = p.toAffine();
  return { x: toBeHex(x, 32), y: toBeHex(y, 32) };
}
export function scalarPoint(value: string): LockPoint { return encode(Point.BASE.multiply(scalar(value))); }

export function createPrivateOffset(): { offset: string; offsetPoint: LockPoint } {
  const offset = toBeHex(randomScalar(), 32);
  return { offset, offsetPoint: scalarPoint(offset) };
}

// Fixed-width ABI encoding binds the proof to both networks and every agreed term.
function transcript(plan: PrivatePlan, commitment: LockPoint): string {
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256[2]", "address[5]", "uint256[4]", "bytes32[2]", "uint256[8]"],
    [id("COMP5521/point-lock-v1"), [11155111, 421614],
      [plan.mst, plan.privateMstHtlc, plan.privateEthHtlc, plan.alice, plan.bob],
      [plan.mstAmount, plan.ethAmount, plan.mstTimelock, plan.ethTimelock],
      [plan.mstSwapId, plan.ethSwapId],
      [plan.mstPoint.x, plan.mstPoint.y, plan.ethPoint.x, plan.ethPoint.y,
        plan.offsetPoint.x, plan.offsetPoint.y, commitment.x, commitment.y]],
  ));
}
export function privatePlanDigest(plan: PrivatePlan): string { return transcript(plan, { x: toBeHex(0, 32), y: toBeHex(0, 32) }); }

export function verifyPrivatePlan(value: unknown, offset?: string): asserts value is PrivatePlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid private plan");
  const plan = value as PrivatePlan;
  if (plan.version !== "point-lock-v1") throw new Error("Unsupported private plan version");
  for (const address of [plan.mst, plan.privateMstHtlc, plan.privateEthHtlc, plan.alice, plan.bob]) {
    if (typeof address !== "string" || getAddress(address) === ZeroAddress) throw new Error("Invalid private plan address");
  }
  if (getAddress(plan.alice) === getAddress(plan.bob)) throw new Error("Participants must differ");
  for (const amount of [plan.mstAmount, plan.ethAmount]) {
    if (typeof amount !== "string" || !/^[1-9]\d*$/.test(amount) || BigInt(amount) > MaxUint256) throw new Error("Invalid private plan amount");
  }
  if (![plan.mstTimelock, plan.ethTimelock].every(v => Number.isSafeInteger(v) && v > 0)
    || plan.mstTimelock <= plan.ethTimelock) throw new Error("Invalid ordered private deadlines");
  if (![plan.mstSwapId, plan.ethSwapId].every(v => typeof v === "string" && isHexString(v, 32) && BigInt(v) > 0n)
    || plan.mstSwapId.toLowerCase() === plan.ethSwapId.toLowerCase()) throw new Error("Private swaps require distinct nonzero identifiers");
  for (const hash of [plan.mstLockTx, plan.ethLockTx]) {
    if (hash !== undefined && !isHexString(hash, 32)) throw new Error("Invalid private lock receipt");
  }
  const eth = point(plan.ethPoint), mst = point(plan.mstPoint), shift = point(plan.offsetPoint);
  if (eth.equals(mst) || !eth.add(shift).equals(mst)) throw new Error("Unrelated private lock points");
  if (offset !== undefined && !Point.BASE.multiply(scalar(offset)).equals(shift)) throw new Error("Bob's private offset does not match");
  if (!plan.proof || typeof plan.proof !== "object") throw new Error("Missing private proof");
  const commitment = point(plan.proof.commitment);
  const z = scalar(plan.proof.response, true);
  const challenge = BigInt(transcript(plan, plan.proof.commitment)) % SCALAR_ORDER;
  const left = z === 0n ? Point.ZERO : Point.BASE.multiply(z);
  const right = commitment.add(challenge === 0n ? Point.ZERO : eth.multiplyUnsafe(challenge));
  if (!left.equals(right)) throw new Error("Invalid Schnorr proof");
}

export function createPrivatePlan(
  config: PrivateConfiguration, alice: string, bob: string, offsetPoint: LockPoint, timestamp: number,
  mst = "1", eth = "0.0001", ethDuration = 600, mstDuration = 1200,
): { plan: PrivatePlan; aliceSecret: string } {
  const shift = point(offsetPoint);
  let secret = randomScalar(), ethPoint = Point.BASE.multiply(secret);
  while (ethPoint.add(shift).equals(Point.ZERO)) { secret = randomScalar(); ethPoint = Point.BASE.multiply(secret); }
  const nonce = randomScalar();
  const plan: PrivatePlan = {
    version: "point-lock-v1", mst: config.mst, privateMstHtlc: config.privateMstHtlc, privateEthHtlc: config.privateEthHtlc,
    alice: getAddress(alice), bob: getAddress(bob),
    mstAmount: parseEther(mst).toString(), ethAmount: parseEther(eth).toString(),
    mstSwapId: hexlify(randomBytes(32)), ethSwapId: hexlify(randomBytes(32)),
    mstTimelock: timestamp + mstDuration, ethTimelock: timestamp + ethDuration,
    mstPoint: encode(ethPoint.add(shift)), ethPoint: encode(ethPoint), offsetPoint: encode(shift),
    proof: { commitment: encode(Point.BASE.multiply(nonce)), response: "" },
  };
  const challenge = BigInt(transcript(plan, plan.proof.commitment)) % SCALAR_ORDER;
  plan.proof.response = toBeHex((nonce + challenge * secret) % SCALAR_ORDER, 32);
  verifyPrivatePlan(plan);
  return { plan, aliceSecret: toBeHex(secret, 32) };
}

export function derivePrivateClaim(plan: PrivatePlan, revealed: string, offset: string): string {
  verifyPrivatePlan(plan, offset);
  const a = scalar(revealed);
  if (!Point.BASE.multiply(a).equals(point(plan.ethPoint))) throw new Error("Incorrect first claim value");
  const b = (a + scalar(offset)) % SCALAR_ORDER;
  if (b === 0n || !Point.BASE.multiply(b).equals(point(plan.mstPoint))) throw new Error("Incorrect second claim value");
  return toBeHex(b, 32);
}

export function importPrivateSwap(
  value: unknown, current?: { plan: PrivatePlan; aliceSecret: string; offset: string },
): { plan: PrivatePlan; aliceSecret: string; offset: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid private import");
  const wrapper = value as Record<string, unknown>;
  const imported = "plan" in wrapper ? wrapper.plan : wrapper;
  verifyPrivatePlan(imported);
  // Allowlist fields: a shared plan must never acquire either participant's scalar.
  const plan: PrivatePlan = {
    version: imported.version, mst: imported.mst, privateMstHtlc: imported.privateMstHtlc, privateEthHtlc: imported.privateEthHtlc,
    alice: imported.alice, bob: imported.bob, mstAmount: imported.mstAmount, ethAmount: imported.ethAmount,
    mstSwapId: imported.mstSwapId.toLowerCase(), ethSwapId: imported.ethSwapId.toLowerCase(),
    mstTimelock: imported.mstTimelock, ethTimelock: imported.ethTimelock,
    mstPoint: { x: imported.mstPoint.x, y: imported.mstPoint.y },
    ethPoint: { x: imported.ethPoint.x, y: imported.ethPoint.y }, offsetPoint: { x: imported.offsetPoint.x, y: imported.offsetPoint.y },
    proof: { commitment: { x: imported.proof.commitment.x, y: imported.proof.commitment.y }, response: imported.proof.response },
    mstLockTx: imported.mstLockTx, ethLockTx: imported.ethLockTx,
  };
  const same = current?.plan.mstSwapId.toLowerCase() === plan.mstSwapId;
  if (same && privatePlanDigest(current.plan) !== privatePlanDigest(plan)) throw new Error("Private import changes the agreed terms");
  const aliceSecret = (typeof wrapper.aliceSecret === "string" ? wrapper.aliceSecret : "") || (same ? current.aliceSecret : "");
  const offset = (typeof wrapper.offset === "string" ? wrapper.offset : "") || (same ? current.offset : "");
  if (wrapper.aliceSecret !== undefined && typeof wrapper.aliceSecret !== "string") throw new Error("Invalid Alice secret");
  if (wrapper.offset !== undefined && typeof wrapper.offset !== "string") throw new Error("Invalid Bob offset");
  if (aliceSecret && !point(scalarPoint(aliceSecret)).equals(point(plan.ethPoint))) throw new Error("Alice secret does not match");
  if (offset) verifyPrivatePlan(plan, offset);
  if (same) { plan.mstLockTx ??= current.plan.mstLockTx; plan.ethLockTx ??= current.plan.ethLockTx; }
  return { plan, aliceSecret, offset };
}
