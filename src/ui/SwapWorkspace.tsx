import { useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider, formatEther, getAddress } from "ethers";
import config from "../public-config.json";
import {
  TOKEN_ABI, claimSwap, createPlan, explorers, importSwap, lockEth, lockMst, readSwap,
  refundSwap, revealedPreimage, verifyLock,
  type Chain, type ReceiptEvidence, type SwapPlan, type SwapState,
} from "../../shared/protocol";
import { switchMetaMaskNetwork } from "../../shared/wallet";
import type { TransactionUpdate } from "../../shared/transactions";
import { TransactionStatus } from "./TransactionStatus";
import { ActionLabel, ChainGlyph, EmptyGlyph, Icon, SwapProgress, phaseClass, roleSlug, shortAmount, shortHex, timeoutNotice } from "./parts";

const providers = { ethereum: new JsonRpcProvider(config.ethereumRpc), arbitrum: new JsonRpcProvider(config.arbitrumRpc) };

export function SwapWorkspace({ account }: { account: string | null }) {
  const [alice, setAlice] = useState(account ?? "");
  const [bob, setBob] = useState("");
  const [mstAmount, setMstAmount] = useState("1");
  const [ethAmount, setEthAmount] = useState("0.0001");
  const [short, setShort] = useState(false);
  const [plan, setPlan] = useState<SwapPlan | null>(null);
  const [secret, setSecret] = useState("");
  const [importText, setImportText] = useState("");
  const [claimTx, setClaimTx] = useState("");
  const [states, setStates] = useState<Partial<Record<Chain, SwapState>>>({});
  const [chainErrors, setChainErrors] = useState<Partial<Record<Chain, string>>>({});
  const [balances, setBalances] = useState({ mst: "-", sepolia: "-", arbitrum: "-" });
  const [transactions, setTransactions] = useState<ReceiptEvidence[]>([]);
  const [pending, setPending] = useState<TransactionUpdate | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const currentView = useRef({ account, swapId: plan?.swapId });
  currentView.current = { account, swapId: plan?.swapId };
  useEffect(() => { if (account && !alice) setAlice(account); }, [account, alice]);
  useEffect(() => { setVerified(false); }, [plan?.swapId]);
  useEffect(() => {
    let current = true;
    const update = async () => { try { await refresh(); } catch { if (current) setMessage("Chain refresh failed. Retry Refresh chains."); } };
    void update();
    const timer = setInterval(() => { void update(); }, 10_000);
    return () => { current = false; clearInterval(timer); };
  }, [account, plan]);

  async function refresh(current = plan) {
    const owner = account;
    const relevant = () => currentView.current.account === owner && currentView.current.swapId === current?.swapId;
    const reads: Promise<void>[] = [];
    if (current) {
      for (const chain of ["ethereum", "arbitrum"] as const) {
        reads.push((async () => {
          try {
            const state = await readSwap(providers[chain], chain === "ethereum" ? config.erc20Htlc : config.ethHtlc, current.swapId);
            if (relevant()) {
              setStates((old) => ({ ...old, [chain]: state }));
              setChainErrors((old) => ({ ...old, [chain]: undefined }));
            }
          } catch {
            if (relevant()) {
              setStates((old) => ({ ...old, [chain]: undefined }));
              setChainErrors((old) => ({ ...old, [chain]: "State unavailable. Retry Refresh chains." }));
            }
          }
        })());
      }
    }
    if (owner) {
      const balancesToRead: [keyof typeof balances, Promise<bigint>][] = [
        ["mst", new Contract(config.mst, TOKEN_ABI, providers.ethereum).balanceOf(owner)],
        ["sepolia", providers.ethereum.getBalance(owner)],
        ["arbitrum", providers.arbitrum.getBalance(owner)],
      ];
      for (const [asset, request] of balancesToRead) {
        reads.push((async () => {
          let amount = "-";
          try { amount = formatEther(await request); } catch { /* Other balances remain available. */ }
          if (relevant()) setBalances((old) => ({ ...old, [asset]: amount }));
        })());
      }
    } else setBalances({ mst: "-", sepolia: "-", arbitrum: "-" });
    await Promise.all(reads);
  }

  async function action(label: string, run: () => Promise<void>) {
    setBusy(label); setMessage(`${label}: checking parameters...`); setPending(null);
    try { await run(); setMessage(`${label}: completed.`); }
    catch (error) {
      const details = error as { shortMessage?: string; message?: string };
      setMessage(details.shortMessage ?? details.message ?? "Operation failed");
    } finally { setBusy(""); setPending(old => old?.stage === "signature" ? null : old); }
  }

  const progress = (event: ReceiptEvidence) => {
    setTransactions((old) => [...old, event]);
    setMessage(`${event.action} confirmed in block ${event.blockNumber}`);
  };
  const observe = (event: TransactionUpdate) => setPending(event.stage === "confirmed" ? null : event);

  async function signer(chain: Chain) {
    if (!window.ethereum) throw new Error("Install MetaMask to sign transactions");
    await switchMetaMaskNetwork(chain === "ethereum" ? 11155111 : 421614);
    const provider = new BrowserProvider(window.ethereum);
    return provider.getSigner();
  }

  async function prepare() {
    const [mstBlock, ethBlock] = await Promise.all([providers.ethereum.getBlock("latest"), providers.arbitrum.getBlock("latest")]);
    if (!mstBlock || !ethBlock) throw new Error("Latest blocks unavailable");
    const generated = createPlan(alice, bob, Math.max(mstBlock.timestamp, ethBlock.timestamp), mstAmount, ethAmount, short ? 90 : 600, short ? 180 : 1200);
    setPlan(generated.plan); setSecret(generated.preimage); setClaimTx(""); setStates({}); setChainErrors({}); setTransactions([]); setVerified(false);
    setMessage("Plan prepared. Save the private secret before locking; share only the public plan with Bob.");
  }

  async function lock(chain: Chain) {
    if (!plan) throw new Error("Prepare or import a plan first");
    const signing = await signer(chain);
    const hash = chain === "ethereum" ? await lockMst(signing, providers.arbitrum, config, plan, progress, observe)
      : await lockEth(signing, providers.ethereum, config, plan, progress, observe);
    const next = { ...plan, ...(chain === "ethereum" ? { mstLockTx: hash } : { ethLockTx: hash }) };
    setPlan(next); void refresh(next);
  }

  async function claim(chain: Chain) {
    if (!plan) throw new Error("Select a plan");
    let preimage = secret;
    if (chain === "ethereum") {
      preimage = await revealedPreimage(providers.arbitrum, config, plan, claimTx);
      setSecret(preimage);
    }
    const hash = await claimSwap(await signer(chain), providers[chain === "ethereum" ? "arbitrum" : "ethereum"], config, plan, chain, preimage, progress, observe);
    if (chain === "arbitrum") setClaimTx(hash);
    void refresh();
  }

  async function refund(chain: Chain) {
    if (!plan) throw new Error("Select a plan");
    await refundSwap(await signer(chain), config, plan, chain, progress, observe); void refresh();
  }

  async function importPlan() {
    const next = importSwap(JSON.parse(importText), plan ? { plan, preimage: secret } : undefined);
    const sameSwap = plan?.swapId.toLowerCase() === next.plan.swapId;
    setPlan(next.plan); setSecret(next.preimage); setVerified(false); setStates({}); setChainErrors({});
    if (!sameSwap) { setClaimTx(""); setTransactions([]); }
  }

  function downloadSecret() {
    if (!plan || !secret) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ plan, preimage: secret }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `private-swap-${plan.swapId}.json`; link.click(); URL.revokeObjectURL(url);
  }

  const role = account && plan ? getAddress(account) === getAddress(plan.alice) ? "Alice" : getAddress(account) === getAddress(plan.bob) ? "Bob" : "Observer" : "Not connected";
  const planExpired = plan ? Object.values(states).some((state) => state && state.timestamp >= plan.ethTimelock) : false;
  const ethPhase = states.ethereum?.phase;
  const arbPhase = states.arbitrum?.phase;
  const steps = [
    { label: "Plan", detail: "Secret, hashlock, deadlines", done: !!plan },
    { label: "Lock MST", detail: "Alice on Ethereum", done: !!ethPhase && ethPhase !== "Missing" },
    { label: "Verify", detail: "Bob checks the MST lock", done: verified },
    { label: "Lock ETH", detail: "Bob on Arbitrum", done: !!arbPhase && arbPhase !== "Missing" },
    { label: "Claim ETH", detail: "Alice reveals the secret", done: arbPhase === "Claimed" },
    { label: "Claim MST", detail: "Bob reuses the secret", done: ethPhase === "Claimed" },
  ];
  return <section className="swap-workspace desk" aria-labelledby="desk-title">
    <header className="section-head">
      <div>
        <p className="eyebrow"><span>03</span> OPERATE THE SWAP</p>
        <h2 id="desk-title">Live exchange desk</h2>
        <p className="section-lede">Alice locks MST on Ethereum Sepolia. Bob verifies it and locks ETH on Arbitrum Sepolia. Alice claims ETH; Bob reads the revealed secret and claims MST.</p>
      </div>
      <button className="btn ghost" disabled={!!busy} onClick={() => void refresh()}><Icon name="refresh" />Refresh chains</button>
    </header>

    <div className="stat-row balance-strip">
      <div className="stat" data-tilt="10"><span>Current role</span><strong className={`role-text role-${roleSlug(role)}`}>{role}</strong><small>{account ? shortHex(account) : "Connect MetaMask"}</small></div>
      <div className="stat" data-tilt="10"><span>MST</span><strong title={balances.mst}>{shortAmount(balances.mst)}</strong><small>ERC-20 on Ethereum Sepolia</small></div>
      <div className="stat" data-tilt="10"><span>Sepolia ETH</span><strong title={balances.sepolia}>{shortAmount(balances.sepolia)}</strong><small>Native on Ethereum Sepolia</small></div>
      <div className="stat" data-tilt="10"><span>Arbitrum ETH</span><strong title={balances.arbitrum}>{shortAmount(balances.arbitrum)}</strong><small>Native on Arbitrum Sepolia</small></div>
    </div>

    <SwapProgress steps={steps} notice={timeoutNotice(states)} />

    <div className="desk-grid">
      <article className="panel reveal">
        <h3><span className="step-no">1.</span> Agree on the exchange</h3>
        <label>Alice address<input value={alice} onChange={(e) => setAlice(e.target.value)} placeholder="0x..." spellCheck={false} autoComplete="off" /></label>
        <label>Bob address<input value={bob} onChange={(e) => setBob(e.target.value)} placeholder="0x..." spellCheck={false} autoComplete="off" /></label>
        <div className="amount-fields"><label>MST amount<input inputMode="decimal" value={mstAmount} onChange={(e) => setMstAmount(e.target.value)} /></label><label>ETH amount<input inputMode="decimal" value={ethAmount} onChange={(e) => setEthAmount(e.target.value)} /></label></div>
        <label className="check-label"><input type="checkbox" checked={short} onChange={(e) => setShort(e.target.checked)} /><span>Demo deadlines: ETH 90s / MST 180s (otherwise 600s / 1200s)</span></label>
        <button className="btn primary block" disabled={!!busy} onClick={() => action("Prepare", prepare)}>Generate plan and secret</button>
        <div className="divider" aria-hidden="true"><span>or</span></div>
        <label>Import public plan or private recovery file<textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste JSON here" spellCheck={false} /></label>
        <button className="btn ghost block" disabled={!!busy} onClick={() => action("Import", importPlan)}>Import plan</button>
      </article>

      <article className="panel reveal">
        <h3><span className="step-no">2.</span> Lock, verify and claim</h3>
        {plan ? <>
          <dl className="swap-details">
            <div className="wide accent"><dt>Agreed amounts</dt><dd>{formatEther(plan.mstAmount)} MST / {formatEther(plan.ethAmount)} ETH</dd></div>
            <div className="wide"><dt>Alice / Bob</dt><dd>{plan.alice}<br />{plan.bob}</dd></div>
            <div className="wide"><dt>Swap ID</dt><dd>{plan.swapId}</dd></div>
            <div className="wide"><dt>Hashlock</dt><dd>{plan.hashlock}</dd></div>
            <div><dt>ETH deadline</dt><dd>{new Date(plan.ethTimelock * 1000).toLocaleString()}</dd></div>
            <div><dt>MST deadline</dt><dd>{new Date(plan.mstTimelock * 1000).toLocaleString()}</dd></div>
          </dl>
          {planExpired && states.ethereum?.phase === "Missing" && <p className="alert" role="alert">This plan's ETH deadline has expired. Generate a new plan before locking. Existing locks remain available for timeout recovery.</p>}
          <div className="swap-actions">
            <button className="btn action" disabled={!!busy || role !== "Alice" || planExpired || states.ethereum?.phase !== "Missing" || !states.arbitrum} onClick={() => action("Lock MST", () => lock("ethereum"))}><ActionLabel text="Alice: approve and lock MST" /></button>
            <button className="btn action" disabled={!!busy || !plan.mstLockTx} onClick={() => action("Verify MST lock", async () => { await verifyLock(providers.ethereum, config, plan, "ethereum"); setVerified(true); void refresh(); })}><ActionLabel text="Independently verify MST" /></button>
            <button className="btn action" disabled={!!busy || role !== "Bob" || planExpired || !verified || states.ethereum?.phase !== "Active" || ![undefined, "Missing"].includes(states.arbitrum?.phase)} onClick={() => action("Lock ETH", () => lock("arbitrum"))}><ActionLabel text="Bob: create matching ETH lock" /></button>
            <button className="btn action" disabled={!!busy || role !== "Alice" || !secret || !plan.ethLockTx || states.arbitrum?.phase !== "Active" || states.ethereum?.phase !== "Active"} onClick={() => action("Claim ETH", () => claim("arbitrum"))}><ActionLabel text="Alice: verify and claim ETH" /></button>
          </div>
          <div className="claim-box">
            <label>ETH claim transaction hash<input value={claimTx} onChange={(e) => setClaimTx(e.target.value)} placeholder="0x... from Alice's confirmed ETH claim" spellCheck={false} autoComplete="off" /></label>
            <button className="btn action" disabled={!!busy || role !== "Bob" || !claimTx || states.ethereum?.phase !== "Active"} onClick={() => action("Read revealed secret and claim MST", () => claim("ethereum"))}><ActionLabel text="Bob: observe secret and claim MST" /></button>
          </div>
          <details><summary>Public plan (share after MST lock)</summary><textarea readOnly value={JSON.stringify(plan, null, 2)} /></details>
          <details className="secret"><summary>Private secret / recovery backup</summary><p className="swap-hint">Keep private until claiming ETH. It is never included in the public plan.</p><input type="password" aria-label="Private preimage" value={secret} onChange={(e) => setSecret(e.target.value)} /><button className="btn ghost" onClick={downloadSecret}>Download private backup</button></details>
        </> : <div className="panel-empty"><EmptyGlyph /><p className="swap-hint">Generate or import a plan. Switch Alice and Bob in MetaMask when prompted by the workflow.</p></div>}
      </article>
    </div>

    <article className="panel recovery-card reveal">
      <div className="panel-head">
        <h3><span className="step-no">3.</span> Independent status and timeout recovery</h3>
        <p className="swap-hint">Refresh to read each chain's latest block time. Claim/refund availability depends on its current state and connected account.</p>
      </div>
      <div className="state-grid">{(["ethereum", "arbitrum"] as const).map((chain) => {
        const phase = states[chain]?.phase ?? (chainErrors[chain] ? "Unavailable" : "Not loaded");
        return <article key={chain} className={`state-tile ${phaseClass(phase)}`} data-tilt="6">
          <div className="state-top"><ChainGlyph chain={chain} /><strong>{chain === "ethereum" ? "Ethereum Sepolia / MST" : "Arbitrum Sepolia / ETH"}</strong></div>
          <div className="state-main"><span className="orb" aria-hidden="true" /><span className="state-value">{phase}</span></div>
          <small>{states[chain] ? `Block time: ${new Date(states[chain]!.timestamp * 1000).toLocaleTimeString()}` : "Refresh to query this chain"}</small>
          {chainErrors[chain] && <small className="state-error" role="alert">{chainErrors[chain]}</small>}
          <button className="btn ghost" disabled={!!busy || states[chain]?.phase !== "Expired" || role !== (chain === "ethereum" ? "Alice" : "Bob")} onClick={() => action(`Refund ${chain}`, () => refund(chain))}>Sender: refund after expiry</button>
        </article>;
      })}</div>
    </article>

    <p className={`swap-feedback${busy ? " is-busy" : ""}`} role="status" aria-live="polite"><span className="feedback-dot" aria-hidden="true" />{message || "Ready. Connect MetaMask, then refresh balances or prepare an exchange."}</p>
    <TransactionStatus pending={pending} confirmed={transactions} />
    <details className="contracts"><summary>Deployed contracts</summary>
      <dl className="contract-list">
        <div><dt>MST</dt><dd><a href={`${explorers.ethereum}/address/${config.mst}`} target="_blank" rel="noreferrer">{config.mst}</a></dd></div>
        <div><dt>ERC20HTLC</dt><dd><a href={`${explorers.ethereum}/address/${config.erc20Htlc}`} target="_blank" rel="noreferrer">{config.erc20Htlc}</a></dd></div>
        <div><dt>ETHHTLC</dt><dd><a href={`${explorers.arbitrum}/address/${config.ethHtlc}`} target="_blank" rel="noreferrer">{config.ethHtlc}</a></dd></div>
      </dl>
    </details>
  </section>;
}
