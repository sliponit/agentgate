import { useEffect, useRef, useState } from "react";
import { NetworkId, NETWORKS, DEPLOYMENTS } from "../lib/chains";
import { useGasSponsoredEvents, type GasSponsoredEvent } from "../hooks/useGasSponsoredEvents";

interface Props {
  networkId: NetworkId;
  totalCalls: number;
}

interface Field {
  key: string;
  value: string;
  highlight?: boolean;
  live?: boolean; // marks fields pulled from a real on-chain event
}

interface Step {
  id: number;
  from: string;
  fromIcon: string;
  to: string;
  toIcon: string;
  label: string;
  request: { title: string; fields: Field[] };
  response: { title: string; fields: Field[] };
  note: string;
  hasLiveData?: boolean;
}

function fmt(addr: string) { return addr.slice(0, 10) + "…" + addr.slice(-4); }

function buildSteps(
  networkId: NetworkId,
  ev: GasSponsoredEvent | null
): Step[] {
  const dep  = DEPLOYMENTS[networkId];
  const net  = NETWORKS[networkId];
  const pm   = fmt(dep.paymaster);
  const reg  = fmt(dep.publisherRegistry);
  const isLive = ev !== null;

  // Real values when available, demo placeholders otherwise
  const agentAddr     = isLive ? fmt(ev!.agent)        : fmt(dep.deployer) + " (demo)";
  const txHashShort   = isLive ? fmt(ev!.txHash)       : "—";
  const endpointHash  = isLive ? fmt(ev!.endpointHash) : "keccak256('https://…/weather')";
  const gasUsed       = isLive ? ev!.gasUsed.toLocaleString()         : "~180,000";
  const gasCostEth    = isLive
    ? (Number(ev!.gasUsed) / 1e18).toFixed(8) + " " + net.currency
    : "~0.000054 " + net.currency;
  const bpsPct        = isLive ? Math.round(ev!.sponsorshipBps / 100) : 100;
  const remainingBudget = isLive ? "—" : "0.0097 " + net.currency;

  return [
    {
      id: 0,
      from: "AI Agent", fromIcon: "🤖",
      to: "Bundler",    toIcon: "📦",
      label: "UserOperation submitted",
      hasLiveData: isLive,
      request: {
        title: "→ UserOperation",
        fields: [
          { key: "sender",           value: agentAddr,   highlight: true, live: isLive },
          { key: "callData",         value: "0x…(execute)", highlight: true },
          { key: "paymasterAndData", value: pm + " + endpointHash", highlight: true },
          { key: "maxFeePerGas",     value: net.chainId === 296 ? "1200 Gwei" : "≈0.006 Gwei" },
        ],
      },
      response: {
        title: "← Bundler ack",
        fields: [
          { key: "userOpHash", value: isLive ? fmt(ev!.endpointHash) : "pending", live: isLive },
          { key: "status",     value: "queued ✓" },
          { key: "eta",        value: isLive ? "confirmed" : "~2s" },
        ],
      },
      note: "Agent submits a UserOp with paymasterData = endpoint hash. Zero native token needed.",
    },
    {
      id: 1,
      from: "Bundler",        fromIcon: "📦",
      to: "EntryPoint v0.7", toIcon: "⚡",
      label: "handleOps() on-chain",
      request: {
        title: "→ handleOps(ops, beneficiary)",
        fields: [
          { key: "ops.length",  value: "1" },
          { key: "beneficiary", value: fmt(dep.deployer) },
          { key: "txHash",      value: isLive ? fmt(ev!.txHash) : "(pending)", live: isLive },
        ],
      },
      response: {
        title: "← EntryPoint routes",
        fields: [
          { key: "calls",   value: "validatePaymasterUserOp()" },
          { key: "then",    value: "executeUserOp()" },
          { key: "finally", value: "_postOp()" },
        ],
      },
      note: "Bundler packs the op into a tx and calls EntryPoint.handleOps.",
    },
    {
      id: 2,
      from: "EntryPoint v0.7",   fromIcon: "⚡",
      to: "AgentGate Paymaster", toIcon: "🛡️",
      label: "validatePaymasterUserOp()",
      hasLiveData: isLive,
      request: {
        title: "→ validatePaymasterUserOp",
        fields: [
          { key: "endpointHash", value: endpointHash,  highlight: true, live: isLive },
          { key: "maxCost",      value: "≈" + gasCostEth, highlight: true },
          { key: "sender",       value: agentAddr, live: isLive },
        ],
      },
      response: {
        title: "← Validation data",
        fields: [
          { key: "validationData",  value: "0 (valid ✓)", highlight: true },
          { key: "sponsorshipBps",  value: `${bpsPct}% (${bpsPct * 100} bps)`, highlight: true, live: isLive },
          { key: "dailyRemaining",  value: remainingBudget },
        ],
      },
      note: `Paymaster reads endpointSponsorshipBps[hash] = ${bpsPct * 100} bps. Budget check passes. Gas approved.`,
    },
    {
      id: 3,
      from: "AgentGate Paymaster", fromIcon: "🛡️",
      to: "PublisherRegistry",     toIcon: "📋",
      label: "endpoint config lookup",
      request: {
        title: "→ endpointSponsorshipBps[hash]",
        fields: [
          { key: "endpointHash", value: endpointHash, live: isLive },
          { key: "registry",     value: reg },
        ],
      },
      response: {
        title: "← Sponsorship config",
        fields: [
          { key: "bps",          value: `${bpsPct * 100}`, highlight: true, live: isLive },
          { key: "coveredCost",  value: `maxCost × ${bpsPct}%`, highlight: true },
          { key: "paymaster",    value: pm },
        ],
      },
      note: "Paymaster resolves the publisher's gas share. Only that portion counts against daily budget.",
    },
    {
      id: 4,
      from: "EntryPoint v0.7", fromIcon: "⚡",
      to: "SmartAccount",      toIcon: "💼",
      label: "executeUserOp()",
      request: {
        title: "→ execute(target, value, callData)",
        fields: [
          { key: "sender",   value: agentAddr, live: isLive },
          { key: "target",   value: fmt(dep.deployer) },
          { key: "value",    value: "0 " + net.currency },
          { key: "callData", value: "0x (no-op)" },
        ],
      },
      response: {
        title: "← Execution result",
        fields: [
          { key: "success",    value: "true ✓",        highlight: true },
          { key: "returnData", value: "0x" },
          { key: "txHash",     value: isLive ? fmt(ev!.txHash) : "(pending)", live: isLive },
        ],
      },
      note: "SmartAccount executes the agent's intent. No native token spent by the agent.",
    },
    {
      id: 5,
      from: "EntryPoint v0.7",   fromIcon: "⚡",
      to: "AgentGate Paymaster", toIcon: "🛡️",
      label: "_postOp() — finalize",
      hasLiveData: isLive,
      request: {
        title: "→ _postOp(mode, context, actualGasCost)",
        fields: [
          { key: "mode",           value: "opSucceeded" },
          { key: "actualGasCost",  value: gasCostEth,   highlight: true, live: isLive },
          { key: "sponsorshipBps", value: `${bpsPct * 100}`,             live: isLive },
        ],
      },
      response: {
        title: "← Stats updated + event emitted",
        fields: [
          { key: "gasUsed",    value: gasUsed,         highlight: true, live: isLive },
          { key: "totalCalls", value: "+1" },
          { key: "event",      value: `GasSponsored(${agentAddr}, ${bpsPct}%)`, live: isLive },
        ],
      },
      note: isLive
        ? `Real GasSponsored event emitted on-chain: gas=${gasUsed}, bps=${bpsPct * 100}`
        : "EntryPoint calls _postOp with actual cost. Paymaster updates budget and emits event.",
    },
    {
      id: 6,
      from: "Bundler", fromIcon: "📦",
      to: "AI Agent",  toIcon: "🤖",
      label: "Receipt delivered",
      hasLiveData: isLive,
      request: {
        title: "→ UserOperationReceipt",
        fields: [
          { key: "success",   value: "true ✓",                  highlight: true },
          { key: "txHash",    value: isLive ? fmt(ev!.txHash) : "—", highlight: true, live: isLive },
          { key: "gasUsed",   value: gasUsed,                        live: isLive },
          { key: "gasPaidBy", value: "AgentGate Paymaster",    highlight: true },
          { key: "agentPaid", value: "0 " + net.currency + " 🎉" },
        ],
      },
      response: {
        title: "← Agent gets data",
        fields: [
          { key: "status",  value: "200 OK" },
          { key: "cost",    value: isLive ? `0 ${net.currency} gas (${bpsPct}% sponsored)` : `$0.00 gas + $0.01 USDC`, highlight: true, live: isLive },
          { key: "latency", value: isLive ? "on-chain ✓" : "~2.1s" },
        ],
      },
      note: isLive
        ? `Confirmed on-chain. TX: ${fmt(ev!.txHash)}. Agent paid zero gas.`
        : "Agent receives response. Paid $0.01 USDC for data, zero gas management needed.",
    },
  ];
}

function PayloadBox({
  title, fields, color, visible, delay,
}: {
  title: string; fields: Field[]; color: string; visible: boolean; delay: number;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (visible) {
      const t = setTimeout(() => setShow(true), delay);
      return () => clearTimeout(t);
    } else {
      setShow(false);
    }
  }, [visible, delay]);

  return (
    <div style={{
      flex: 1,
      opacity: show ? 1 : 0,
      transform: show ? "translateY(0)" : "translateY(6px)",
      transition: "opacity 0.3s ease, transform 0.3s ease",
      background: "#090909",
      border: `1px solid ${show ? color + "44" : "#111"}`,
      borderRadius: 6,
      padding: "8px 10px",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color, marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>
        {title}
      </div>
      {fields.map((f) => (
        <div key={f.key} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "baseline" }}>
          <span style={{ fontSize: 10, color: "#444", flexShrink: 0, minWidth: 90 }}>{f.key}</span>
          <span style={{
            fontSize: 10,
            color: f.live ? "#4ade80" : f.highlight ? "#e5e7eb" : "#555",
            fontWeight: f.highlight || f.live ? 600 : 400,
            wordBreak: "break-all",
          }}>
            {f.value}
            {f.live && <span style={{ fontSize: 8, color: "#4ade8088", marginLeft: 4 }}>⚡</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function FlowDiagram({ networkId, totalCalls }: Props) {
  const [activeStep, setActiveStep]     = useState<number>(-1);
  const [pinnedStep, setPinnedStep]     = useState<number | null>(null);
  const [running, setRunning]           = useState(false);
  const [liveEvent, setLiveEvent]       = useState<GasSponsoredEvent | null>(null);
  const prevEventsLen                   = useRef(0);
  const net                             = NETWORKS[networkId];

  const { events: liveEvents, latestBlock } = useGasSponsoredEvents(networkId);

  // Use the most recent live event (or null for demo mode)
  const activeEvent = liveEvent;
  const steps       = buildSteps(networkId, activeEvent);
  const isLiveMode  = activeEvent !== null;

  function runAnimation() {
    if (running) return;
    setPinnedStep(null);
    setRunning(true);
    steps.forEach((_, i) => {
      setTimeout(() => {
        setActiveStep(i);
        if (i === steps.length - 1) {
          setTimeout(() => { setActiveStep(-1); setRunning(false); }, 1400);
        }
      }, i * 1000); // 1s per step — feels more realistic than 0.9s
    });
  }

  // Auto-trigger when new real event arrives
  useEffect(() => {
    if (liveEvents.length > prevEventsLen.current) {
      setLiveEvent(liveEvents[0]);
      setTimeout(runAnimation, 200);
    }
    prevEventsLen.current = liveEvents.length;
  }, [liveEvents.length]);

  // Initial demo run on mount / network change
  useEffect(() => {
    const t = setTimeout(runAnimation, 600);
    return () => clearTimeout(t);
  }, [networkId]);

  // Also re-trigger on new totalCalls if no live event yet
  useEffect(() => {
    if (totalCalls > 0 && !isLiveMode) runAnimation();
  }, [totalCalls]);

  const displayStep = pinnedStep !== null ? pinnedStep : activeStep;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "#555" }}>
            ERC-4337 Gas Sponsorship Flow
          </span>

          {/* Mode badge */}
          {isLiveMode ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "2px 8px", borderRadius: 4,
              background: "#0a1a0a", border: "1px solid #1a3a1a",
            }}>
              <div style={{
                width: 5, height: 5, borderRadius: "50%", background: "#4ade80",
                boxShadow: "0 0 6px #4ade80",
                animation: "pulse-dot 1.5s ease-in-out infinite",
              }} />
              <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700, letterSpacing: "0.08em" }}>
                LIVE DATA
              </span>
            </div>
          ) : (
            <div style={{
              padding: "2px 8px", borderRadius: 4,
              background: "#111", border: "1px solid #222",
            }}>
              <span style={{ fontSize: 9, color: "#444", letterSpacing: "0.08em" }}>DEMO</span>
            </div>
          )}

          {/* Block number when watching */}
          {networkId === "baseSepolia" && latestBlock > 0n && (
            <span style={{ fontSize: 9, color: "#2a2a2a" }}>
              block #{latestBlock.toString()}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {isLiveMode && (
            <button
              onClick={() => { setLiveEvent(null); setPinnedStep(null); }}
              style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                padding: "4px 10px", background: "transparent",
                border: "1px solid #1a3a1a", borderRadius: 4, color: "#4ade80", cursor: "pointer",
              }}
            >
              ← demo
            </button>
          )}
          {pinnedStep !== null && (
            <button
              onClick={() => setPinnedStep(null)}
              style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                padding: "4px 10px", background: "transparent",
                border: "1px solid #333", borderRadius: 4, color: "#555", cursor: "pointer",
              }}
            >
              ✕ unpin
            </button>
          )}
          <button
            onClick={runAnimation}
            disabled={running}
            style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              padding: "4px 10px", background: "transparent",
              border: `1px solid ${running ? "#333" : isLiveMode ? "#1a3a1a" : net.color}`,
              borderRadius: 4,
              color: running ? "#555" : isLiveMode ? "#4ade80" : net.color,
              cursor: running ? "default" : "pointer",
              transition: "all 0.2s",
            }}
          >
            {running ? "▶ running…" : isLiveMode ? "▶ replay last tx" : "▶ simulate"}
          </button>
        </div>
      </div>

      {/* ── Live event banner ─────────────────────────────────────────────── */}
      {isLiveMode && activeEvent && (
        <div style={{
          padding: "8px 14px", borderRadius: 6,
          background: "#060f06", border: "1px solid #1a3a1a",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 700 }}>⚡ REAL ON-CHAIN EVENT</span>
          <span style={{ fontSize: 10, color: "#555" }}>agent: {fmt(activeEvent.agent)}</span>
          <span style={{ fontSize: 10, color: "#555" }}>gas: {activeEvent.gasUsed.toLocaleString()}</span>
          <span style={{ fontSize: 10, color: "#4ade80" }}>{Math.round(activeEvent.sponsorshipBps / 100)}% sponsored</span>
          <a
            href={`https://sepolia.basescan.org/tx/${activeEvent.txHash}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10, color: net.color, marginLeft: "auto", textDecoration: "none" }}
          >
            {fmt(activeEvent.txHash)} ↗
          </a>
        </div>
      )}

      {/* ── Step list ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {steps.map((step, i) => {
          const isActive = displayStep === i;
          const isDone   = running && activeStep > i;
          const isPinned = pinnedStep === i;

          return (
            <div key={step.id}>
              <div
                onClick={() => setPinnedStep(isPinned ? null : i)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px",
                  border: `1px solid ${isActive ? (isLiveMode ? "#4ade80" : net.color) : isDone ? "#222" : "#181818"}`,
                  borderRadius: 6,
                  background: isActive ? (isLiveMode ? "#0a1a0a" : `${net.color}0d`) : isDone ? "#0e0e0e" : "#0a0a0a",
                  boxShadow: isActive ? `0 0 12px ${isLiveMode ? "#4ade8022" : net.color + "33"}` : "none",
                  transition: "all 0.25s ease",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                {/* Step number */}
                <div style={{
                  width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700,
                  background: isActive ? (isLiveMode ? "#4ade80" : net.color) : isDone ? "#1e1e1e" : "#111",
                  color: isActive ? "#000" : isDone ? "#444" : "#333",
                  transition: "all 0.25s",
                }}>
                  {isDone ? "✓" : i + 1}
                </div>

                {/* From → To */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>{step.fromIcon}</span>
                  <span style={{ fontSize: 10, color: isActive ? "#aaa" : "#444", whiteSpace: "nowrap" }}>
                    {step.from}
                  </span>
                  <span style={{ fontSize: 10, color: isActive ? (isLiveMode ? "#4ade80" : net.color) : "#333" }}>→</span>
                  <span style={{ fontSize: 13 }}>{step.toIcon}</span>
                  <span style={{ fontSize: 10, color: isActive ? "#aaa" : "#444", whiteSpace: "nowrap" }}>
                    {step.to}
                  </span>
                </div>

                {/* Label */}
                <span style={{
                  fontSize: 11, fontWeight: 600, flexShrink: 0,
                  color: isActive ? (isLiveMode ? "#4ade80" : net.color) : isDone ? "#555" : "#333",
                  transition: "color 0.25s",
                }}>
                  {step.label}
                </span>

                {/* Live badge on steps with real data */}
                {step.hasLiveData && isLiveMode && (
                  <span style={{ fontSize: 8, color: "#4ade80", flexShrink: 0, opacity: 0.7 }}>⚡</span>
                )}

                <span style={{ fontSize: 9, color: "#2a2a2a", flexShrink: 0 }}>
                  {isPinned ? "▲" : "▼"}
                </span>

                {isActive && (
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: isLiveMode ? "#4ade80" : net.color, flexShrink: 0,
                    animation: "pulse-dot 0.8s ease-in-out infinite",
                  }} />
                )}
              </div>

              {/* Expanded payload */}
              {isActive && (
                <div style={{
                  margin: "4px 0 4px 30px",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <div style={{
                    fontSize: 10, color: "#555", fontStyle: "italic",
                    padding: "4px 10px",
                    borderLeft: `2px solid ${isLiveMode ? "#4ade8055" : net.color + "55"}`,
                  }}>
                    {step.note}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <PayloadBox
                      title={step.request.title}
                      fields={step.request.fields}
                      color={isLiveMode ? "#4ade80" : net.color}
                      visible={isActive}
                      delay={0}
                    />
                    <PayloadBox
                      title={step.response.title}
                      fields={step.response.fields}
                      color={isLiveMode ? "#22c55e" : "#4ade80"}
                      visible={isActive}
                      delay={500}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Live Events Feed ──────────────────────────────────────────────── */}
      {networkId === "baseSepolia" && (
        <div>
          <div style={{
            fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
            color: "#2a2a2a", marginBottom: 8, paddingTop: 8,
            borderTop: "1px solid #111",
          }}>
            {liveEvents.length > 0
              ? `GasSponsored events — ${liveEvents.length} found (click to replay)`
              : "No on-chain events yet — run: tsx src/send-userop.ts"}
          </div>

          {liveEvents.length === 0 ? (
            <div style={{
              fontSize: 10, color: "#2a2a2a",
              background: "#080808", border: "1px solid #111", borderRadius: 6,
              padding: "10px 14px", fontFamily: "'JetBrains Mono', monospace",
            }}>
              <span style={{ color: "#333" }}>$ </span>
              <span style={{ color: "#4ade80" }}>cd packages/agent && ./node_modules/.bin/tsx src/send-userop.ts</span>
              <br />
              <span style={{ color: "#444", fontStyle: "italic" }}>
                # sends a real ERC-4337 UserOperation — gas sponsored by AgentGatePaymaster
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {liveEvents.map((ev) => {
                const isSelected = activeEvent?.txHash === ev.txHash;
                return (
                  <div
                    key={ev.txHash}
                    onClick={() => { setLiveEvent(ev); setTimeout(runAnimation, 150); }}
                    style={{
                      display: "flex", gap: 10, alignItems: "center",
                      background: isSelected ? "#060f06" : "#090909",
                      border: `1px solid ${isSelected ? "#1a3a1a" : "#1a1a1a"}`,
                      borderRadius: 5, padding: "6px 10px",
                      cursor: "pointer", transition: "all 0.2s",
                      animation: "fadeIn 0.4s ease",
                    }}
                  >
                    <div style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: isSelected ? "#4ade80" : "#374151" }} />
                    <span style={{ fontSize: 9, color: isSelected ? "#4ade80" : "#555", fontWeight: 700, flexShrink: 0 }}>
                      GasSponsored
                    </span>
                    <span style={{ fontSize: 9, color: "#444", flexShrink: 0 }}>
                      {fmt(ev.agent)}
                    </span>
                    <span style={{ fontSize: 9, color: "#444", flexShrink: 0 }}>
                      gas: {ev.gasUsed.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 9, color: isSelected ? "#4ade80" : "#374151", flexShrink: 0 }}>
                      {Math.round(ev.sponsorshipBps / 100)}% sponsored
                    </span>
                    <span style={{ fontSize: 9, color: "#333", flexShrink: 0 }}>
                      block #{ev.blockNumber.toString()}
                    </span>
                    <a
                      href={`https://sepolia.basescan.org/tx/${ev.txHash}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 9, color: net.color, marginLeft: "auto", textDecoration: "none", flexShrink: 0 }}
                    >
                      {fmt(ev.txHash)} ↗
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.6); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
