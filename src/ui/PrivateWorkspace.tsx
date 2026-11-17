import { useEffect, useRef, useState } from "react";
import { BrowserProvider, JsonRpcProvider, ZeroAddress, formatEther, getAddress } from "ethers";
import config from "../private-config.json";
import rpc from "../public-config.json";
import { createPrivateOffset, createPrivatePlan, importPrivateSwap, scalarPoint, verifyPrivatePlan, type PrivatePlan } from "../../shared/privacy";
import { assertPrivateConfiguration, claimPrivateSwap, lockPrivateSwap, observePrivateClaim, readPrivateSwap, refundPrivateSwap, verifyPrivateLock, type PrivateState } from "../../shared/private-protocol";
import type { Chain, ReceiptEvidence } from "../../shared/protocol";
import type { TransactionUpdate } from "../../shared/transactions";
import { switchMetaMaskNetwork } from "../../shared/wallet";
import { TransactionStatus } from "./TransactionStatus";

const providers = { ethereum: new JsonRpcProvider(rpc.ethereumRpc), arbitrum: new JsonRpcProvider(rpc.arbitrumRpc) };
const configured = config.privateMstHtlc !== ZeroAddress && config.privateEthHtlc !== ZeroAddress;

export function PrivateWorkspace({ account }: { account: string | null }) {
  const [alice, setAlice] = useState(""), [bob, setBob] = useState("");
  const [mstAmount, setMstAmount] = useState("1"), [ethAmount, setEthAmount] = useState("0.0001");
  const [offset, setOffset] = useState(""), [offsetText, setOffsetText] = useState("");
  const [aliceSecret, setAliceSecret] = useState(""), [importText, setImportText] = useState("");
  const [plan, setPlan] = useState<PrivatePlan | null>(null), [claimTx, setClaimTx] = useState("");
  const [states, setStates] = useState<Partial<Record<Chain, PrivateState>>>({});
  const [errors, setErrors] = useState<Partial<Record<Chain, string>>>({});
  const [verified, setVerified] = useState(false), [busy, setBusy] = useState(""), [message, setMessage] = useState("");
  const [transactions, setTransactions] = useState<ReceiptEvidence[]>([]);
  const [pending, setPending] = useState<TransactionUpdate | null>(null);
  const current = useRef(plan); current.current = plan;
  const role = account && plan ? getAddress(account) === getAddress(plan.alice) ? "Alice" : getAddress(account) === getAddress(plan.bob) ? "Bob" : "Observer" : "";
  const expired = plan ? Object.values(states).some(s => s && s.timestamp >= plan.ethTimelock) : false;
  const observe = (event: TransactionUpdate) => setPending(event.stage === "confirmed" ? null : event);
  const progress = (event: ReceiptEvidence) => setTransactions(old => [...old, event]);

  async function refresh(selected = plan) {
    if (!selected) return;
    await Promise.all((["ethereum", "arbitrum"] as const).map(async chain => {
      try {
        const state = await readPrivateSwap(providers[chain], selected, chain);
        if (current.current?.mstSwapId === selected.mstSwapId) {
          setStates(old => ({ ...old, [chain]: state })); setErrors(old => ({ ...old, [chain]: undefined }));
        }
      } catch {
        if (current.current?.mstSwapId === selected.mstSwapId) {
          setStates(old => ({ ...old, [chain]: undefined })); setErrors(old => ({ ...old, [chain]: "RPC unavailable; retry refresh." }));
        }
      }
    }));
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [plan]);

  async function action(label: string, run: () => Promise<void>) {
    setBusy(label); setPending(null); setMessage(`${label}: checking...`);
    try { await run(); setMessage(`${label}: completed.`); }
    catch (error) { const e = error as { shortMessage?: string; message?: string }; setMessage(e.shortMessage ?? e.message ?? "Private operation failed"); }
    finally { setBusy(""); setPending(old => old?.stage === "signature" ? null : old); }
  }
  async function signer(chain: Chain) {
    if (!window.ethereum) throw new Error("Install MetaMask to sign transactions");
    await switchMetaMaskNetwork(chain === "ethereum" ? 11155111 : 421614);
    return new BrowserProvider(window.ethereum).getSigner();
  }
  function select(next: ReturnType<typeof importPrivateSwap>) {
    const same = next.plan.mstSwapId === plan?.mstSwapId;
    setPlan(next.plan); setAliceSecret(next.aliceSecret); setOffset(next.offset);
    setStates({}); setErrors({}); setVerified(false);
    if (!same) { setClaimTx(""); setTransactions([]); }
  }
  async function prepare() {
    if (plan) throw new Error("Start a new private session with a fresh Bob offset for another swap");
    if (!configured) throw new Error("Deploy the two private escrows first");
    const blocks = await Promise.all([providers.ethereum.getBlock("latest"), providers.arbitrum.getBlock("latest")]);
    if (blocks.some(block => !block)) throw new Error("Both chain timestamps are required");
    const next = createPrivatePlan(config, alice, bob, JSON.parse(offsetText), Math.max(...blocks.map(b => b!.timestamp)), mstAmount, ethAmount);
    if (offset) verifyPrivatePlan(next.plan, offset);
    select({ ...next, offset });
  }
  async function importMaterial() {
    const value = JSON.parse(importText);
    if (value?.kind === "point-lock-offset") {
      const derived = scalarPoint(value.offset);
      if (derived.x !== value.offsetPoint?.x || derived.y !== value.offsetPoint?.y) throw new Error("Offset backup does not match its point");
      if (plan) verifyPrivatePlan(plan, value.offset);
      setOffset(value.offset); setOffsetText(JSON.stringify(derived));
      return;
    }
    const next = importPrivateSwap(value, plan ? { plan, aliceSecret, offset } : undefined);
    assertPrivateConfiguration(next.plan, config);
    if (!next.offset && offset) { verifyPrivatePlan(next.plan, offset); next.offset = offset; }
    select(next);
  }
  function download(value: unknown, name: string) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  function reset() {
    setPlan(null); setAliceSecret(""); setOffset(""); setOffsetText(""); setImportText("");
    setClaimTx(""); setStates({}); setErrors({}); setVerified(false); setTransactions([]); setPending(null);
    setMessage("New session: Bob must generate a fresh offset. Keep prior backups for any unfinished swap.");
  }
  async function lock(chain: Chain) {
    if (!plan) throw new Error("Create or import a private plan");
    const hash = await lockPrivateSwap(await signer(chain), providers[chain === "ethereum" ? "arbitrum" : "ethereum"], config, plan, chain, offset, progress, observe);
    setPlan({ ...plan, ...(chain === "ethereum" ? { mstLockTx: hash } : { ethLockTx: hash }) });
  }
  async function claim(chain: Chain) {
    if (!plan) throw new Error("Select a private plan");
    const secret = chain === "arbitrum" ? aliceSecret : await observePrivateClaim(providers.arbitrum, config, plan, claimTx, offset);
    const hash = await claimPrivateSwap(await signer(chain), providers[chain === "ethereum" ? "arbitrum" : "ethereum"], config, plan, chain, secret, progress, observe);
    if (chain === "arbitrum") setClaimTx(hash);
    void refresh();
  }
  return <section className="swap-workspace" id="private-exchange">
    <div className="section-heading"><div><p className="eyebrow">04 / OPTIONAL CHALLENGE</p><h2>Private point-lock exchange</h2></div><button disabled={!!busy} onClick={() => void refresh()}>Refresh private chains</button></div>
    <p className="swap-hint">Bob keeps a private offset. Alice reveals one claim value; only Bob can derive the other. Exchange points, proofs and backups directly with your peer. Addresses, amounts and timing remain public.</p>
    {!configured && <p role="alert">Private escrows are not configured. Deploy them before sending assets.</p>}
    <div className="swap-columns">
      <div className="swap-card"><h3>1. Bob prepares private offset</h3>
        <p className="swap-hint">Use a fresh offset for every swap. Save participant backups before starting another session.</p>
        <button disabled={!!busy || !plan} onClick={reset}>Start new private session</button>
        <button disabled={!!busy || !!plan} onClick={() => { const next = createPrivateOffset(); setOffset(next.offset); setOffsetText(JSON.stringify(next.offsetPoint)); }}>Generate Bob offset</button>
        <label>Bob offset point (share directly with Alice)<textarea value={offsetText} onChange={e => setOffsetText(e.target.value)} /></label>
        <label>Bob private offset<input type="password" value={offset} onChange={e => { setOffset(e.target.value); setVerified(false); }} /></label>
        <button disabled={!offset || !!busy} onClick={() => action("Save Bob backup", async () => download({ kind: "point-lock-offset", offset, offsetPoint: scalarPoint(offset) }, "private-bob-offset.json"))}>Save Bob offset backup</button>
        <h3>2. Alice prepares linked locks</h3>
        <label>Private Alice address<input value={alice} onChange={e => setAlice(e.target.value)} placeholder="0x..." /></label>
        <label>Private Bob address<input value={bob} onChange={e => setBob(e.target.value)} placeholder="0x..." /></label>
        <label>Private MST amount<input value={mstAmount} onChange={e => setMstAmount(e.target.value)} /></label>
        <label>Private ETH amount<input value={ethAmount} onChange={e => setEthAmount(e.target.value)} /></label>
        <button disabled={!!busy || !configured || !!plan} onClick={() => action("Prepare private plan", prepare)}>Generate private plan and proof</button>
        <label>Import peer plan or private backup<textarea value={importText} onChange={e => setImportText(e.target.value)} /></label>
        <button disabled={!!busy} onClick={() => action("Import private material", importMaterial)}>Import private material</button>
      </div>
      <div className="swap-card"><h3>3. Verify, lock and claim</h3>
        {plan ? <>
          <p>Connected role: <strong>{role || "Not connected"}</strong></p>
          <dl className="swap-details"><dt>Amounts</dt><dd>{formatEther(plan.mstAmount)} MST / {formatEther(plan.ethAmount)} ETH</dd><dt>MST swap ID</dt><dd>{plan.mstSwapId}</dd><dt>ETH swap ID</dt><dd>{plan.ethSwapId}</dd><dt>MST point</dt><dd>{plan.mstPoint.x}<br />{plan.mstPoint.y}</dd><dt>ETH point</dt><dd>{plan.ethPoint.x}<br />{plan.ethPoint.y}</dd><dt>Deadlines</dt><dd>ETH: {new Date(plan.ethTimelock * 1000).toLocaleString()}<br />MST: {new Date(plan.mstTimelock * 1000).toLocaleString()}</dd></dl>
          <div className="swap-actions">
            <button disabled={!!busy || role !== "Alice" || expired || states.ethereum?.phase !== "Missing" || !states.arbitrum} onClick={() => action("Private MST lock", () => lock("ethereum"))}>Alice: approve and lock private MST</button>
            <button disabled={!!busy || !offset || !plan.mstLockTx} onClick={() => action("Verify private linkage", async () => { verifyPrivatePlan(plan, offset); await verifyPrivateLock(providers.ethereum, config, plan, "ethereum"); setVerified(true); })}>Bob: verify proof, offset and MST lock</button>
            <button disabled={!!busy || role !== "Bob" || !verified || !offset || expired || states.ethereum?.phase !== "Active" || states.arbitrum?.phase !== "Missing"} onClick={() => action("Private ETH lock", () => lock("arbitrum"))}>Bob: lock private ETH</button>
            <button disabled={!!busy || role !== "Alice" || !aliceSecret || states.ethereum?.phase !== "Active" || states.arbitrum?.phase !== "Active"} onClick={() => action("First private claim", () => claim("arbitrum"))}>Alice: claim private ETH</button>
          </div>
          <label>First private ETH claim transaction<input value={claimTx} onChange={e => setClaimTx(e.target.value)} /></label>
          <button disabled={!!busy || role !== "Bob" || !offset || !claimTx || states.ethereum?.phase !== "Active"} onClick={() => action("Derived private claim", () => claim("ethereum"))}>Bob: derive value and claim private MST</button>
          <details><summary>Peer handoff (never publish)</summary><textarea readOnly value={JSON.stringify(plan, null, 2)} /></details>
          <details><summary>Participant backup</summary><label>Alice private claim value<input type="password" value={aliceSecret} onChange={e => setAliceSecret(e.target.value)} /></label><button onClick={() => download({ plan, aliceSecret, offset }, `private-${plan.mstSwapId}.json`)}>Save private participant backup</button></details>
        </> : <p>Bob saves his offset first. Alice uses only his point to prepare the plan. Save each participant's backup before locking.</p>}
      </div>
    </div>
    <div className="state-grid">{(["ethereum", "arbitrum"] as const).map(chain => <article key={chain}>
      <strong>{chain === "ethereum" ? "Private MST / Ethereum Sepolia" : "Private ETH / Arbitrum Sepolia"}</strong>
      <span className="state-value">{states[chain]?.phase ?? (errors[chain] ? "Unavailable" : "Not loaded")}</span>
      {states[chain] && <small>Block time: {new Date(states[chain]!.timestamp * 1000).toLocaleTimeString()}</small>}
      {errors[chain] && <small role="alert">{errors[chain]}</small>}
      <button disabled={!!busy || !plan || states[chain]?.phase !== "Expired" || role !== (chain === "ethereum" ? "Alice" : "Bob")} onClick={() => action("Private refund", async () => { await refundPrivateSwap(await signer(chain), config, plan!, chain, progress, observe); void refresh(); })}>Sender: refund private lock after expiry</button>
    </article>)}</div>
    <p className="swap-feedback" role="status">{message || "Private linkage is checked before the second asset is committed."}</p>
    <TransactionStatus pending={pending} confirmed={transactions} />
    <details><summary>Private deployed contracts</summary><p className="swap-hint">MST: {config.mst}<br />MST point escrow: {config.privateMstHtlc}<br />ETH point escrow: {config.privateEthHtlc}</p></details>
  </section>;
}
