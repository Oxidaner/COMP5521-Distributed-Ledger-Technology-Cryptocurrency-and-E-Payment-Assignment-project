import { useEffect, useState } from "react";
import { getAddress } from "ethers";
import { connectMetaMask, parseChainId, switchMetaMaskNetwork } from "../../shared/wallet";
import { SwapWorkspace } from "./SwapWorkspace";
import { PrivateWorkspace } from "./PrivateWorkspace";
import config from "../public-config.json";

export function Dashboard() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [active, setActive] = useState<"overview" | "create" | "recover">("overview");

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;

    const handleAccountsChanged = (value: unknown) => {
      if (!Array.isArray(value) || typeof value[0] !== "string") {
        setAccount(null);
        return;
      }
      try {
        setAccount(getAddress(value[0]));
      } catch {
        setAccount(null);
      }
    };
    const handleChainChanged = (value: unknown) => {
      const nextChainId = parseChainId(value);
      if (nextChainId !== null) setChainId(nextChainId);
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  async function handleConnectWallet() {
    try {
      const wallet = await connectMetaMask();
      setAccount(wallet.account);
      setChainId(wallet.chainId);
      setWalletError(null);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function handleSwitchNetwork(targetChainId: 11155111 | 421614) {
    try {
      await switchMetaMaskNetwork(targetChainId);
      setChainId(targetChainId);
      setWalletError(null);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Network switch failed.");
    }
  }

  const chainName = chainId === 11155111
    ? "Ethereum Sepolia"
    : chainId === 421614
      ? "Arbitrum Sepolia"
      : chainId === null
        ? "Wallet not connected"
        : `Unsupported network (${chainId})`;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#overview"><span className="brand-mark">H</span><span>HTLC / COMP5521</span></a>
        <div className="top-actions">
          <span className="network"><i />Sepolia pair</span>
          {account && <span className="wallet-chain">{chainName}</span>}
          <button className="wallet" onClick={handleConnectWallet}>
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="masthead">
        <div className="mast-copy">
          <p className="eyebrow"><span>01</span> CROSS-CHAIN ESCROW</p>
          <h1>Exchange assets.<br /><em>Keep the promise.</em></h1>
          <p className="lede">A guided atomic swap between MST on Ethereum Sepolia and ETH on Arbitrum Sepolia.</p>
          <div className="mast-actions">
            <a className="primary" href="#live-exchange">Start a swap <span aria-hidden="true">↗</span></a>
            <a className="text-button" href="#live-exchange">Recover a swap <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="exchange-art" aria-label="Two chain escrow flow">
          <div className="art-head"><span>ATOMIC PATH</span><span>LIVE PAIR <i /></span></div>
          <div className="rail rail-one"><span className="rail-dot" /><span className="rail-label">ETHEREUM / SEPOLIA</span></div>
          <div className="rail rail-two"><span className="rail-dot" /><span className="rail-label">ARBITRUM / SEPOLIA</span></div>
          <div className="lock lock-one"><span>01 / LOCK</span><strong>MST</strong><small>Alice → Bob</small></div>
          <div className="lock lock-two"><span>02 / COUNTERLOCK</span><strong>ETH</strong><small>Bob → Alice</small></div>
          <div className="hash-badge"><span>H</span><div><small>SHARED HASHLOCK</small><strong>keccak256(secret)</strong></div></div>
          <span className="art-index">FIG 01 — 2026</span>
        </div>
      </section>

      <section className="workspace" id="overview">
        <aside className="sidebar">
          <p className="side-label">WORKSPACE</p>
          {(["overview", "create", "recover"] as const).map((item, index) => (
            <button key={item} className={`nav-item ${active === item ? "selected" : ""}`} onClick={() => { setActive(item); if (item !== "overview") document.getElementById("live-exchange")?.scrollIntoView({ behavior: "smooth" }); }}>
              <span className="nav-number">0{index + 1}</span><span>{item === "overview" ? "Overview" : item === "create" ? "New exchange" : "Recovery"}</span>
              {active === item && <span className="nav-arrow">↗</span>}
            </button>
          ))}
          <div className="sidebar-note"><span className="note-mark">i</span><p>Each chain is verified independently. Neither escrow calls the other.</p></div>
        </aside>

        <div className="main-panel">
          <div className="section-heading">
            <div><p className="eyebrow"><span>02</span> {active === "overview" ? "YOUR ACTIVITY" : active === "create" ? "NEW EXCHANGE" : "TIMEOUT TOOLS"}</p>
              <h2>{active === "overview" ? "Swap overview" : active === "create" ? "Prepare an exchange" : "Recover locked assets"}</h2></div>
            <a className="refresh" href="#live-exchange" aria-label="Open live status" title="Open live status">↻</a>
          </div>

          <div className="chain-head"><span>CHAIN STATUS</span><span>TEST NETWORKS</span></div>
          {walletError && <p className="wallet-message" role="alert">{walletError}</p>}
          {account && <div className="wallet-network-actions">
            <span>Connected: {account}</span>
            <button onClick={() => handleSwitchNetwork(11155111)}>Switch to Sepolia</button>
            <button onClick={() => handleSwitchNetwork(421614)}>Switch to Arbitrum Sepolia</button>
          </div>}
          <div className="chain-row">
            <div className="chain-identity"><span className="chain-icon eth-icon">Ξ</span><div><strong>Ethereum Sepolia</strong><small>Chain ID 11155111 · MST escrow</small></div></div>
            <span className="status-pill"><i />Contracts deployed</span>
            <a className="row-arrow" href={`https://sepolia.etherscan.io/address/${config.erc20Htlc}`} target="_blank" rel="noreferrer" title="Inspect Ethereum contract" aria-label="Inspect Ethereum contract">↗</a>
          </div>
          <div className="chain-row">
            <div className="chain-identity"><span className="chain-icon arb-icon">A</span><div><strong>Arbitrum Sepolia</strong><small>Chain ID 421614 · ETH escrow</small></div></div>
            <span className="status-pill"><i />Contract deployed</span>
            <a className="row-arrow" href={`https://sepolia.arbiscan.io/address/${config.ethHtlc}`} target="_blank" rel="noreferrer" title="Inspect Arbitrum contract" aria-label="Inspect Arbitrum contract">↗</a>
          </div>

          <div className="empty-state">
            <div className="empty-glyph"><span /><span /></div>
            <div><strong>Live exchange desk ready</strong><p>Connect MetaMask, then prepare or import a plan in the exchange desk.</p></div>
            <a className="text-button" href="#live-exchange">Open exchange <span aria-hidden="true">→</span></a>
          </div>
          <footer className="panel-footer"><span>ATOMIC SWAP PROTOCOL</span><span>SEPOLIA ↔ ARBITRUM SEPOLIA</span></footer>
        </div>
      </section>
      <div id="live-exchange"><SwapWorkspace account={account} /></div>
      <PrivateWorkspace account={account} />
      <footer className="page-footer"><span>COMP5521 / DISTRIBUTED LEDGER TECHNOLOGY</span><span>LOCAL DEVELOPMENT BUILD</span></footer>
    </main>
  );
}
