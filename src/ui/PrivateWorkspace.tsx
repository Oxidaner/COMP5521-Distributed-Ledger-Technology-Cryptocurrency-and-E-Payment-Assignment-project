import { useEffect, useRef, useState } from "react";
import { BrowserProvider, JsonRpcProvider, ZeroAddress, formatEther, getAddress } from "ethers";
import config from "../private-config.json";
import rpc from "../public-config.json";
import { createPrivateOffset, createPrivatePlan, importPrivateSwap, scalarPoint, verifyPrivatePlan, type PrivatePlan } from "../../shared/privacy";
import { assertPrivateConfiguration, claimPrivateSwap, lockPrivateSwap, observePrivateClaim, readPrivateSwap, refundPrivateSwap, verifyPrivateLock, type PrivateState } from "../../shared/private-protocol";
import { explorers, type Chain, type ReceiptEvidence } from "../../shared/protocol";
import type { TransactionUpdate } from "../../shared/transactions";
import { switchMetaMaskNetwork } from "../../shared/wallet";
import { TransactionStatus } from "./TransactionStatus";
import { ActionLabel, ChainGlyph, EmptyGlyph, Icon, SwapProgress, phaseClass, roleSlug, timeoutNotice } from "./parts";

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
  const ethPhase = states.ethereum?.phase, arbPhase = states.arbitrum?.phase;
  const steps = [
    { label: "Offset", detail: "Bob's private point", done: !!offsetText || !!plan },
    { label: "Plan & proof", detail: "Alice links both locks", done: !!plan },
    { label: "Lock MST", detail: "Alice on Ethereum", done: !!ethPhase && ethPhase !== "Missing" },
    { label: "Verify", detail: "Bob checks proof and lock", done: verified },
    { label: "Lock ETH", detail: "Bob on Arbitrum", done: !!arbPhase && arbPhase !== "Missing" },
    { label: "Claim ETH", detail: "Alice reveals one value", done: arbPhase === "Claimed" },
    { label: "Claim MST", detail: "Bob derives the other", done: ethPhase === "Claimed" },
  ];
  const shownRole = role || "Not connected";

  return <section className="swap-workspace desk private-desk" id="private-exchange" aria-labelledby="private-title">
    <header className="section-head">
      <div>
        <p className="eyebrow"><span>04</span> OPTIONAL CHALLENGE</p>
        <h2 id="private-title">Private point-lock exchange</h2>
        <p className="swap-hint section-lede">Bob keeps a private offset. Alice reveals one claim value; only Bob can derive the other. Exchange points, proofs and backups directly with your peer. Addresses, amounts and timing remain public.</p>
      </div>
      <button className="btn ghost" disabled={!!busy} onClick={() => void refresh()}><Icon name="refresh" />Refresh private chains</button>
    </header>
    {!configured && <p className="alert" role="alert">Private escrows are not configured. Deploy them before sending assets.</p>}
    <SwapProgress steps={steps} notice={timeoutNotice(states)} />
    <div className="desk-grid">
      <div className="desk-stack">
        <article className="panel reveal">
          <h3><span className="step-no">1.</span> Bob prepares private offset</h3>
          <p className="swap-hint">Use a fresh offset for every swap. Save participant backups before starting another session.</p>
          <div className="button-row">
            <button className="btn ghost" disabled={!!busy || !plan} onClick={reset}>Start new private session</button>
            <button className="btn primary" disabled={!!busy || !!plan} onClick={() => { const next = createPrivateOffset(); setOffset(next.offset); setOffsetText(JSON.stringify(next.offsetPoint)); }}>Generate Bob offset</button>
          </div>
          <label>Bob offset point (share directly with Alice)<textarea spellCheck={false} value={offsetText} onChange={e => setOffsetText(e.target.value)} /></label>
          <label>Bob private offset<input type="password" autoComplete="off" value={offset} onChange={e => { setOffset(e.target.value); setVerified(false); }} /></label>
          <button className="btn ghost block" disabled={!offset || !!busy} onClick={() => action("Save Bob backup", async () => download({ kind: "point-lock-offset", offset, offsetPoint: scalarPoint(offset) }, "private-bob-offset.json"))}>Save Bob offset backup</button>
        </article>
        <article className="panel reveal">
          <h3><span className="step-no">2.</span> Alice prepares linked locks</h3>
          <label>Private Alice address<input value={alice} spellCheck={false} autoComplete="off" onChange={e => setAlice(e.target.value)} placeholder="0x..." /></label>
          <label>Private Bob address<input value={bob} spellCheck={false} autoComplete="off" onChange={e => setBob(e.target.value)} placeholder="0x..." /></label>
          <div className="amount-fields">
            <label>Private MST amount<input inputMode="decimal" value={mstAmount} onChange={e => setMstAmount(e.target.value)} /></label>
            <label>Private ETH amount<input inputMode="decimal" value={ethAmount} onChange={e => setEthAmount(e.target.value)} /></label>
          </div>
          <button className="btn primary block" disabled={!!busy || !configured || !!plan} onClick={() => action("Prepare private plan", prepare)}>Generate private plan and proof</button>
          <div className="divider"><span>or</span></div>
          <label>Import peer plan or private backup<textarea spellCheck={false} placeholder="Paste JSON here" value={importText} onChange={e => setImportText(e.target.value)} /></label>
          <button className="btn ghost block" disabled={!!busy} onClick={() => action("Import private material", importMaterial)}>Import private material</button>
        </article>
      </div>
      <article className="panel reveal">
        <h3><span className="step-no">3.</span> Verify, lock and claim</h3>
        {plan ? <>
          <p className="role-line">Connected role: <strong className={`role-chip role-${roleSlug(shownRole)}`}>{shownRole}</strong></p>
          <dl className="swap-details">
            <div className="wide accent"><dt>Amounts</dt><dd>{formatEther(plan.mstAmount)} MST / {formatEther(plan.ethAmount)} ETH</dd></div>
            <div className="wide"><dt>MST swap ID</dt><dd>{plan.mstSwapId}</dd></div>
            <div className="wide"><dt>ETH swap ID</dt><dd>{plan.ethSwapId}</dd></div>
            <div className="wide"><dt>MST point</dt><dd>{plan.mstPoint.x}<br />{plan.mstPoint.y}</dd></div>
            <div className="wide"><dt>ETH point</dt><dd>{plan.ethPoint.x}<br />{plan.ethPoint.y}</dd></div>
            <div className="wide"><dt>Deadlines</dt><dd>ETH: {new Date(plan.ethTimelock * 1000).toLocaleString()}<br />MST: {new Date(plan.mstTimelock * 1000).toLocaleString()}</dd></div>
          </dl>
          <div className="swap-actions">
            <button className="btn action" disabled={!!busy || role !== "Alice" || expired || states.ethereum?.phase !== "Missing" || !states.arbitrum} onClick={() => action("Private MST lock", () => lock("ethereum"))}><ActionLabel text="Alice: approve and lock private MST" /></button>
            <button className="btn action" disabled={!!busy || !offset || !plan.mstLockTx} onClick={() => action("Verify private linkage", async () => { verifyPrivatePlan(plan, offset); await verifyPrivateLock(providers.ethereum, config, plan, "ethereum"); setVerified(true); })}><ActionLabel text="Bob: verify proof, offset and MST lock" /></button>
            <button className="btn action" disabled={!!busy || role !== "Bob" || !verified || !offset || expired || states.ethereum?.phase !== "Active" || states.arbitrum?.phase !== "Missing"} onClick={() => action("Private ETH lock", () => lock("arbitrum"))}><ActionLabel text="Bob: lock private ETH" /></button>
            <button className="btn action" disabled={!!busy || role !== "Alice" || !aliceSecret || states.ethereum?.phase !== "Active" || states.arbitrum?.phase !== "Active"} onClick={() => action("First private claim", () => claim("arbitrum"))}><ActionLabel text="Alice: claim private ETH" /></button>
          </div>
          <div className="claim-box">
            <label>First private ETH claim transaction<input value={claimTx} spellCheck={false} autoComplete="off" placeholder="0x..." onChange={e => setClaimTx(e.target.value)} /></label>
            <button className="btn action" disabled={!!busy || role !== "Bob" || !offset || !claimTx || states.ethereum?.phase !== "Active"} onClick={() => action("Derived private claim", () => claim("ethereum"))}><ActionLabel text="Bob: derive value and claim private MST" /></button>
          </div>
          <details><summary>Peer handoff (never publish)</summary><textarea readOnly spellCheck={false} value={JSON.stringify(plan, null, 2)} /></details>
          <details className="secret"><summary>Participant backup</summary><label>Alice private claim value<input type="password" autoComplete="off" value={aliceSecret} onChange={e => setAliceSecret(e.target.value)} /></label><button className="btn ghost block" onClick={() => download({ plan, aliceSecret, offset }, `private-${plan.mstSwapId}.json`)}>Save private participant backup</button></details>
        </> : <div className="panel-empty"><EmptyGlyph /><p className="swap-hint">Bob saves his offset first. Alice uses only his point to prepare the plan. Save each participant's backup before locking.</p></div>}
      </article>
    </div>
    <article className="panel recovery-card reveal">
      <div className="panel-head"><h3>Private escrow status</h3><p className="swap-hint">Each private escrow is read on its own chain. The sender can refund once that lock has expired.</p></div>
      <div className="state-grid">{(["ethereum", "arbitrum"] as const).map(chain => {
        const phase = states[chain]?.phase ?? (errors[chain] ? "Unavailable" : "Not loaded");
        return <article key={chain} className={`state-tile ${phaseClass(phase)}`} data-tilt="6">
          <div className="state-top"><ChainGlyph chain={chain} /><strong>{chain === "ethereum" ? "Private MST / Ethereum Sepolia" : "Private ETH / Arbitrum Sepolia"}</strong></div>
          <div className="state-main"><span className="orb" aria-hidden="true" /><span className="state-value">{phase}</span></div>
          {states[chain] && <small>Block time: {new Date(states[chain]!.timestamp * 1000).toLocaleTimeString()}</small>}
          {errors[chain] && <small className="state-error" role="alert">{errors[chain]}</small>}
          <button className="btn ghost" disabled={!!busy || !plan || states[chain]?.phase !== "Expired" || role !== (chain === "ethereum" ? "Alice" : "Bob")} onClick={() => action("Private refund", async () => { await refundPrivateSwap(await signer(chain), config, plan!, chain, progress, observe); void refresh(); })}>Sender: refund private lock after expiry</button>
        </article>;
      })}</div>
      <p className={`swap-feedback${busy ? " is-busy" : ""}`} role="status"><span className="feedback-dot" aria-hidden="true" />{message || "Private linkage is checked before the second asset is committed."}</p>
      <TransactionStatus pending={pending} confirmed={transactions} />
    </article>
    <details className="contracts">
      <summary>Private deployed contracts</summary>
      <dl className="contract-list">
        <div><dt>MST</dt><dd><a href={`${explorers.ethereum}/address/${config.mst}`} target="_blank" rel="noreferrer">{config.mst}</a></dd></div>
        <div><dt>MST point escrow</dt><dd><a href={`${explorers.ethereum}/address/${config.privateMstHtlc}`} target="_blank" rel="noreferrer">{config.privateMstHtlc}</a></dd></div>
        <div><dt>ETH point escrow</dt><dd><a href={`${explorers.arbitrum}/address/${config.privateEthHtlc}`} target="_blank" rel="noreferrer">{config.privateEthHtlc}</a></dd></div>
      </dl>
    </details>
  </section>;
}
