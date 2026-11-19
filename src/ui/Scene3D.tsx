import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";

const STAGE_WIDTH = 560;
const faces = ["front", "back", "right", "left", "top", "bottom"] as const;

function Coin({ kind, symbol }: { kind: "mst" | "eth"; symbol: string }) {
  return <div className={`coin-anchor coin-${kind}`}>
    <span className="coin-shadow" />
    <div className="coin-bob">
      <div className="coin">
        {Array.from({ length: 9 }, (_, index) => <span key={index} className="coin-edge" style={{ "--z": `${index - 4}px` } as CSSProperties} />)}
        <span className="coin-face front"><b>{symbol}</b></span>
        <span className="coin-face back"><b>{symbol}</b></span>
      </div>
    </div>
  </div>;
}

/** CSS-only 3D illustration of the two escrows bound by one hashlock. */
export function Scene3D() {
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = root.current, frame = viewport.current;
    if (!element || !frame) return;
    const apply = (width: number) => element.style.setProperty("--scale", Math.min(1, width / STAGE_WIDTH).toFixed(3));
    apply(frame.clientWidth);
    const observer = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let targetX = 0, targetY = 0, x = 0, y = 0, frame = 0;
    const tick = () => {
      x += (targetX - x) * 0.08;
      y += (targetY - y) * 0.08;
      element.style.setProperty("--px", x.toFixed(3));
      element.style.setProperty("--py", y.toFixed(3));
      frame = Math.abs(targetX - x) > 0.002 || Math.abs(targetY - y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType !== "mouse") return;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      targetX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
      targetY = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
      if (!frame) frame = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="scene" ref={root} role="img" aria-label="Atomic path: MST locked on Ethereum Sepolia and ETH counter-locked on Arbitrum Sepolia, both bound to one shared hashlock, keccak256 of the secret.">
    <div className="scene-head" aria-hidden="true"><span>ATOMIC PATH</span><span className="live">LIVE PAIR <i /></span></div>
    <div className="scene-viewport" ref={viewport} aria-hidden="true">
      <div className="scene-scale">
        <div className="stage">
          <div className="sway">
            <div className="floor"><span className="floor-grid" /><span className="floor-ring r1" /><span className="floor-ring r2" /><span className="floor-ring r3" /></div>
            <div className="vault-glow" />
            <div className="orbit o1"><span /></div>
            <div className="orbit o2"><span /></div>
            <div className="vault">
              <div className="vault-spin">
                {faces.map(face => <span key={face} className={`face ${face}`}>{face === "front" || face === "back" ? <b>H</b> : <i />}</span>)}
              </div>
            </div>
            <div className="vault-core" />
            <div className="beam beam-l"><i /></div>
            <div className="beam beam-r"><i /></div>
            <Coin kind="mst" symbol="MST" />
            <Coin kind="eth" symbol="Ξ" />
            <div className="tag tag-l"><span>01 / LOCK</span><strong>MST</strong><small>Alice → Bob</small><em>ETHEREUM / SEPOLIA</em></div>
            <div className="tag tag-r"><span>02 / COUNTERLOCK</span><strong>ETH</strong><small>Bob → Alice</small><em>ARBITRUM / SEPOLIA</em></div>
            <div className="tag tag-c"><span className="hash-mark">H</span><span className="hash-copy"><small>SHARED HASHLOCK</small><strong>keccak256(secret)</strong></span></div>
          </div>
        </div>
      </div>
    </div>
    <span className="art-index" aria-hidden="true">FIG 01 — 2026</span>
  </div>;
}
