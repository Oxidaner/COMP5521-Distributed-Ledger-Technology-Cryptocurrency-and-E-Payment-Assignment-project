import type { CSSProperties, ReactNode } from "react";

type IconName =
  | "refresh" | "arrowUpRight" | "arrowRight" | "check" | "lock" | "shield" | "key"
  | "overview" | "protocol" | "exchange" | "private" | "wallet";

const paths: Record<IconName, ReactNode> = {
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4" />,
  arrowUpRight: <path d="M7 17L17 7M8 7h9v9" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></>,
  overview: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  protocol: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  exchange: <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  private: <><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15.5" r="1.5" /></>,
  wallet: <><path d="M3 7a2 2 0 0 1 2-2h12v4" /><rect x="3" y="7" width="18" height="13" rx="2.5" /><circle cx="16" cy="13.5" r="1.3" /></>,
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ? `icon ${className}` : "icon"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/** Splits "Alice: approve and lock MST" into a role chip and the action while keeping the exact text content. */
export function ActionLabel({ text }: { text: string }) {
  const split = text.indexOf(": ");
  if (split < 0) return <>{text}</>;
  const role = text.slice(0, split);
  return <><span className={`role-chip role-${roleSlug(role)}`}>{role}:</span>{" "}<span>{text.slice(split + 2)}</span></>;
}

export type ProgressStep = { label: string; detail: string; done: boolean };

export function SwapProgress({ steps, notice }: { steps: ProgressStep[]; notice?: string }) {
  const reached = steps.reduce((last, step, index) => (step.done ? index : last), -1);
  const current = reached + 1 < steps.length ? reached + 1 : -1;
  const fill = steps.length > 1 ? Math.max(0, reached) / (steps.length - 1) : 0;
  return <div className="progress">
    <ol aria-label="Swap progress" style={{ "--count": steps.length, "--fill": fill } as CSSProperties}>
      {steps.map((step, index) => {
        const state = index <= reached ? "done" : index === current ? "current" : "todo";
        return <li key={step.label} className={state} aria-current={index === current ? "step" : undefined}>
          <span className="node" aria-hidden="true">{state === "done" ? <Icon name="check" /> : String(index + 1).padStart(2, "0")}</span>
          <strong>{step.label}</strong>
          <small>{step.detail}</small>
          {state !== "todo" && <span className="sr-only">{state === "done" ? "Complete" : "Next step"}</span>}
        </li>;
      })}
    </ol>
    {notice && <p className="progress-notice">{notice}</p>}
  </div>;
}

export function timeoutNotice(states: Partial<Record<"ethereum" | "arbitrum", { phase: string } | undefined>>) {
  const parts = (["ethereum", "arbitrum"] as const).flatMap(chain => {
    const phase = states[chain]?.phase;
    return phase === "Expired" || phase === "Refunded" ? [`${chain === "ethereum" ? "Ethereum" : "Arbitrum"}: ${phase}`] : [];
  });
  return parts.length ? `Timeout path · ${parts.join(" · ")}` : undefined;
}

export const phaseClass = (phase?: string) => `phase-${(phase ?? "Not loaded").toLowerCase().replace(/\s+/g, "-")}`;
export const roleSlug = (role: string) => (role || "none").toLowerCase().replace(/\s+/g, "-");
export const shortHex = (value: string) => value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;

export function shortAmount(value: string) {
  const [whole, decimals = ""] = value.split(".");
  return decimals.length > 6 ? `${whole}.${decimals.slice(0, 6)}…` : value;
}

export function ChainGlyph({ chain }: { chain: "ethereum" | "arbitrum" }) {
  return <span className={`chain-glyph ${chain}`} aria-hidden="true">{chain === "ethereum" ? "Ξ" : "A"}</span>;
}

export function EmptyGlyph() {
  return <div className="empty-glyph" aria-hidden="true"><span /><span /><span /></div>;
}
