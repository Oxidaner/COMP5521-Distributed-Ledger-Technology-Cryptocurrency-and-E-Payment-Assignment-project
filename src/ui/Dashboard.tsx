import { useEffect, useState, type CSSProperties } from "react";
import { getAddress } from "ethers";
import { connectMetaMask, parseChainId, switchMetaMaskNetwork } from "../../shared/wallet";
import { SwapWorkspace } from "./SwapWorkspace";
import { PrivateWorkspace } from "./PrivateWorkspace";
import { Scene3D } from "./Scene3D";
import { useTiltEffect } from "./effects";
import { ChainGlyph, EmptyGlyph, Icon, shortHex } from "./parts";
import config from "../public-config.json";

const tabs = {
  overview: {
    label: "Overview",
    eyebrow: "YOUR ACTIVITY",
    title: "Swap overview",
    note: "Both escrows are live on public test networks. Connect MetaMask to see your role, balances and network.",
  },
  create: {
    label: "New exchange",
    eyebrow: "NEW EXCHANGE",
    title: "Prepare an exchange",
    note: "Agree on addresses and amounts, generate the secret, then lock MST first. Bob counter-locks only after verifying it.",
  },
  recover: {
    label: "Recovery",
    eyebrow: "TIMEOUT TOOLS",
    title: "Recover locked assets",
    note: "Import the public plan or your private backup. Each sender can refund once its own deadline has passed.",
  },
} as const;

const protocolSteps = [
  { index: "01", icon: "lock", chain: "ethereum", title: "Lock MST", body: "Alice locks MST in the ERC20 escrow under H = keccak256(secret). Only the hash is public." },
  { index: "02", icon: "shield", chain: "arbitrum", title: "Verify & counter-lock", body: "Bob independently verifies the MST lock, then locks ETH with the same hashlock and an earlier deadline." },
  { index: "03", icon: "key", chain: "arbitrum", title: "Claim ETH", body: "Alice claims ETH with the secret, which publishes it on Arbitrum Sepolia." },
  { index: "04", icon: "check", chain: "ethereum", title: "Claim MST", body: "Bob reads the revealed secret from Alice's claim and takes MST. A missed deadline refunds each sender." },
] as const;

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

  useTiltEffect();

  const tab = tabs[active];
  const walletChain = chainId === 11155111 ? "ethereum" : chainId === 421614 ? "arbitrum" : chainId === null ? "none" : "unsupported";
  const avatarHue = account ? parseInt(account.slice(2, 6), 16) % 360 : 250;

  return (
    <>
      <div className="backdrop" aria-hidden="true">
        <span className="aurora a1" /><span className="aurora a2" /><span className="aurora a3" />
        <span className="stars" /><span className="noise" />
      </div>

      <header className="topbar">
        <div className="shell topbar-inner">
          <a className="brand" href="#top" aria-label="HTLC / COMP5521 home">
            <span className="brand-cube" aria-hidden="true"><span><i /><i /><i /><i /><i /><i /></span></span>
            <span className="brand-text"><strong>HTLC</strong><small>COMP5521</small></span>
          </a>
          <nav className="top-nav" aria-label="Sections">
            <a href="#overview">Overview</a>
            <a href="#protocol">Protocol</a>
            <a href="#live-exchange">Exchange</a>
            <a href="#private-exchange">Private</a>
          </nav>
          <div className="top-actions">
            <span className="network"><i />Sepolia pair</span>
            {account && <span className="wallet-chain" data-chain={walletChain}><i />{chainName}</span>}
            <button className={account ? "wallet-button connected" : "wallet-button"} onClick={handleConnectWallet}>
              {account ? <span className="wallet-avatar" style={{ "--hue": avatarHue } as CSSProperties} aria-hidden="true" /> : <Icon name="wallet" />}
              {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect wallet"}
            </button>
          </div>
        </div>
      </header>

      <main className="shell" id="top">
        <section className="hero">
          <div className="hero-floor" aria-hidden="true" />
          <div className="hero-copy">
            <p className="eyebrow-chip"><b>01</b>CROSS-CHAIN ESCROW</p>
            <h1>Exchange assets.<br /><em>Keep the promise.</em></h1>
            <p className="lede">A guided atomic swap between MST on Ethereum Sepolia and ETH on Arbitrum Sepolia.</p>
            <div className="hero-actions">
              <a className="btn primary lg" href="#live-exchange">Start a swap <Icon name="arrowUpRight" /></a>
              <a className="btn ghost lg" href="#live-exchange">Recover a swap <Icon name="arrowRight" /></a>
            </div>
            <dl className="hero-metrics">
              <div><dt>2 chains</dt><dd>Verified independently</dd></div>
              <div><dt>1 hashlock</dt><dd>keccak256(secret)</dd></div>
              <div><dt>10 → 20 min</dt><dd>Staggered deadlines</dd></div>
            </dl>
          </div>
          <Scene3D />
        </section>

        <section className="protocol" id="protocol" aria-labelledby="protocol-title">
          <header className="section-head">
            <div>
              <p className="eyebrow"><span>HOW</span> PROTOCOL IN FOUR MOVES</p>
              <h2 id="protocol-title">One secret, two escrows.</h2>
            </div>
            <p className="section-lede">Neither contract trusts the other. Each chain is checked on its own, and every lock carries a deadline after which its sender can refund.</p>
          </header>
          <ol className="protocol-grid">
            {protocolSteps.map(step => <li key={step.index} className={`protocol-card ${step.chain}`} data-tilt="9">
              <div className="protocol-top">
                <span className="protocol-icon"><Icon name={step.icon} /></span>
                <span className="protocol-index">{step.index}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="protocol-chain"><ChainGlyph chain={step.chain} />{step.chain === "ethereum" ? "Ethereum Sepolia" : "Arbitrum Sepolia"}</span>
            </li>)}
          </ol>
        </section>

        <section className="overview reveal" id="overview" aria-label="Workspace overview">
          <aside className="sidebar">
            <p className="side-label">WORKSPACE</p>
            <div className="side-tabs" role="tablist" aria-label="Workspace views">
              {(Object.keys(tabs) as Array<keyof typeof tabs>).map((key, index) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={active === key}
                  className={active === key ? "nav-item selected" : "nav-item"}
                  onClick={() => {
                    setActive(key);
                    if (key !== "overview") document.getElementById("live-exchange")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <span className="nav-number">0{index + 1}</span>
                  <span className="nav-label">{tabs[key].label}</span>
                  {active === key && <span className="nav-arrow" aria-hidden="true">↗</span>}
                </button>
              ))}
            </div>
            <div className="sidebar-note">
              <span className="note-mark" aria-hidden="true">i</span>
              <p>Each chain is verified independently. Neither escrow calls the other.</p>
            </div>
          </aside>

          <div className="main-panel panel">
            <div className="panel-top">
              <div>
                <p className="eyebrow"><span>02</span> {tab.eyebrow}</p>
                <h2>{tab.title}</h2>
                <p className="tab-note">{tab.note}</p>
              </div>
              <a className="icon-button" href="#live-exchange" aria-label="Open exchange desk to refresh chains" title="Refresh in the exchange desk"><Icon name="refresh" /></a>
            </div>

            {walletError && <p className="alert wallet-message" role="alert">{walletError}</p>}

            {account && <div className="wallet-network-actions">
              <div className="wallet-id">
                <span className="wallet-avatar lg" style={{ "--hue": avatarHue } as CSSProperties} aria-hidden="true" />
                <div>
                  <small>Connected</small>
                  <code>{account}</code>
                </div>
              </div>
              <span className="wallet-chain" data-chain={walletChain}><i />{chainName}</span>
              <div className="switch-buttons">
                <button className="btn ghost sm" onClick={() => void handleSwitchNetwork(11155111)}>Switch to Sepolia</button>
                <button className="btn ghost sm" onClick={() => void handleSwitchNetwork(421614)}>Switch to Arbitrum Sepolia</button>
              </div>
            </div>}

            <div className="chain-head"><span>CHAIN STATUS</span><span>TEST NETWORKS</span></div>
            <div className="chain-grid">
              <article className="chain-card ethereum" data-tilt="7">
                <div className="chain-identity">
                  <ChainGlyph chain="ethereum" />
                  <div><strong>Ethereum Sepolia</strong><small>Chain ID 11155111 · MST escrow</small></div>
                </div>
                <div className="chain-meta">
                  <span className="status-pill"><i />Contracts deployed</span>
                  <code>{shortHex(config.erc20Htlc)}</code>
                </div>
                <a className="row-arrow" href={`https://sepolia.etherscan.io/address/${config.erc20Htlc}`} target="_blank" rel="noreferrer" aria-label="Inspect Ethereum contract"><Icon name="arrowUpRight" /></a>
              </article>
              <article className="chain-card arbitrum" data-tilt="7">
                <div className="chain-identity">
                  <ChainGlyph chain="arbitrum" />
                  <div><strong>Arbitrum Sepolia</strong><small>Chain ID 421614 · ETH escrow</small></div>
                </div>
                <div className="chain-meta">
                  <span className="status-pill"><i />Contract deployed</span>
                  <code>{shortHex(config.ethHtlc)}</code>
                </div>
                <a className="row-arrow" href={`https://sepolia.arbiscan.io/address/${config.ethHtlc}`} target="_blank" rel="noreferrer" aria-label="Inspect Arbitrum contract"><Icon name="arrowUpRight" /></a>
              </article>
            </div>

            <div className="empty-state">
              <EmptyGlyph />
              <div>
                <h3>Live exchange desk ready</h3>
                <p>Connect MetaMask, then prepare or import a plan in the exchange desk.</p>
              </div>
              <a className="btn primary" href="#live-exchange">Open exchange <Icon name="arrowRight" /></a>
            </div>

            <footer className="panel-footer"><span>ATOMIC SWAP PROTOCOL</span><span>SEPOLIA ↔ ARBITRUM SEPOLIA</span></footer>
          </div>
        </section>

        <div id="live-exchange">
          <SwapWorkspace account={account} />
        </div>

        <PrivateWorkspace account={account} />

        <footer className="page-footer">
          <span>COMP5521 / DISTRIBUTED LEDGER TECHNOLOGY</span>
          <span>LOCAL DEVELOPMENT BUILD</span>
        </footer>
      </main>

      <nav className="dock" aria-label="Quick navigation">
        <a href="#overview"><Icon name="overview" /><span>Overview</span></a>
        <a href="#protocol"><Icon name="protocol" /><span>Protocol</span></a>
        <a href="#live-exchange"><Icon name="exchange" /><span>Exchange</span></a>
        <a href="#private-exchange"><Icon name="private" /><span>Private</span></a>
      </nav>
    </>
  );
}
