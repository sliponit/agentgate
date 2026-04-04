import { useState, useCallback } from "react";
import { NetworkId, NETWORKS } from "./lib/chains";
import { useOnChainData } from "./hooks/useOnChainData";
import { NetworkCard } from "./components/NetworkCard";
import { FlowDiagram } from "./components/FlowDiagram";
import { EndpointTable } from "./components/EndpointTable";
import { PublishForm } from "./components/PublishForm";
import { ManageEndpoint } from "./components/ManageEndpoint";
import { DemoScenarios } from "./components/DemoScenarios";

type View = "dashboard" | "flow" | "publish" | "manage";

const NETWORK_IDS: NetworkId[] = ["hedera"];

export default function App() {
  const [activeNet, setActiveNet] = useState<NetworkId>("hedera");
  const [view, setView]           = useState<View>("dashboard");
  const [publishDemo, setPublishDemo] = useState<"vacation" | "article" | null>(null);
  const clearPublishDemo = useCallback(() => setPublishDemo(null), []);
  const { data, refetch }         = useOnChainData(activeNet);
  const net = NETWORKS[activeNet];

  return (
    <div className="app">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <span className="logo">AgentGate</span>
          <span className="logo-sub">Publisher Dashboard</span>
        </div>
        <div className="header-right">
          <span className="live-indicator">
            <span className="live-dot" style={{ background: data.loading ? "#555" : net.color }} />
            live
          </span>
          <button className="refresh-btn" onClick={refetch} title="Refresh">↺</button>
        </div>
      </header>

      {/* ── Network tabs ─────────────────────────────────────────────────── */}
      <div className="tabs">
        {NETWORK_IDS.map((id) => {
          const n = NETWORKS[id];
          const isActive = id === activeNet;
          return (
            <button
              key={id}
              onClick={() => setActiveNet(id)}
              className={`tab ${isActive ? "tab-active" : ""}`}
              style={isActive ? { borderColor: n.color, color: n.color, background: `${n.color}0f` } : {}}
            >
              <span className="tab-dot" style={{ background: isActive ? n.color : "#333" }} />
              {n.label}
              <span className="tab-chain-id" style={{ color: isActive ? n.color : "#333" }}>/{n.chainId}</span>
            </button>
          );
        })}

        {/* View switcher */}
        <div className="view-tabs">
          {(["dashboard", "flow", "publish", "manage"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`view-tab ${view === v ? "view-tab-active" : ""}`}
              style={view === v ? { color: net.color, borderColor: net.color + "66" } : {}}
            >
              {v === "dashboard" ? "📊 dashboard" :
               v === "flow"      ? "⚡ flow" :
               v === "publish"   ? "➕ publish" :
                                   "⚙ manage"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Views ────────────────────────────────────────────────────────── */}

      {view === "dashboard" && (
        <>
          <DemoScenarios
            networkId={activeNet}
            onChoose={(id) => {
              setPublishDemo(id);
              setView("publish");
            }}
          />
          <main className="main-grid">
            <section className="panel">
              <NetworkCard networkId={activeNet} data={data} />
            </section>
            <section className="panel">
              <EndpointTable
                networkId={activeNet}
                endpoints={data.endpoints}
                loading={data.loading}
              />
            </section>
          </main>
        </>
      )}

      {view === "flow" && (
        <section className="panel panel-full">
          <FlowDiagram networkId={activeNet} totalCalls={data.totalCalls} />
        </section>
      )}

      {view === "publish" && (
        <main className="publish-grid">
          <section className="panel">
            <div className="section-header">
              <span className="section-title">Publish New Endpoint</span>
              <span className="section-sub">
                All endpoints go through AgentGate — x402 payment + WorldID always enforced.
              </span>
            </div>
            <PublishForm
              networkId={activeNet}
              demoTemplate={publishDemo}
              onDemoTemplateConsumed={clearPublishDemo}
            />
          </section>
          <section className="panel publish-sidebar">
            {/* Contracts */}
            <div className="sidebar-block">
              <div className="sidebar-label">Contracts on {net.label}</div>
              {([
                ["PublisherRegistry", "0xFBCee3E39A0909549fbc28cac37141d01f946189"],
                ["AgentGatePaymaster", "0xfbC79b8d8b7659ce21DD37b82f988b9134c262a1"],
                ["EntryPoint v0.7", "0x0000000071727De22E5E9d8BAf0edAc6f37da032"],
              ] as const).map(([label, addr]) => (
                <div key={label} className="sidebar-row">
                  <span className="sidebar-key">{label}</span>
                  <a href={net.explorerAddr(addr)} target="_blank" rel="noreferrer" className="sidebar-addr" style={{ color: net.color }}>
                    {addr.slice(0, 10)}…{addr.slice(-6)} ↗
                  </a>
                </div>
              ))}
            </div>
            {/* Chain Stats */}
            <div className="sidebar-block">
              <div className="sidebar-label">Live Chain Data</div>
              <div className="sidebar-stats">
                <div className="stat-box">
                  <div className="stat-val" style={{ color: net.color }}>{data.endpoints.length}</div>
                  <div className="stat-key">endpoints</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val" style={{ color: "#4ade80" }}>{data.totalCalls}</div>
                  <div className="stat-key">total calls</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val">{data.paymasterDeposit}</div>
                  <div className="stat-key">{net.currency} staked</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val">{data.totalSponsored}</div>
                  <div className="stat-key">{net.currency} sponsored</div>
                </div>
              </div>
            </div>
            {/* How it works */}
            <div className="sidebar-block">
              <div className="sidebar-label">How it works</div>
              <div className="sidebar-steps">
                <div className="step-row"><span className="step-num" style={{ color: net.color }}>1</span> You provide a backend URL + API key</div>
                <div className="step-row"><span className="step-num" style={{ color: net.color }}>2</span> AgentGate registers it on-chain with a price</div>
                <div className="step-row"><span className="step-num" style={{ color: net.color }}>3</span> Agents discover your endpoint and pay HBAR per call</div>
                <div className="step-row"><span className="step-num" style={{ color: net.color }}>4</span> AgentGate verifies payment, forwards request to your API</div>
                <div className="step-row"><span className="step-num" style={{ color: net.color }}>5</span> Your API key stays server-side — agents never see it</div>
              </div>
            </div>
            {/* Registered endpoints */}
            {data.endpoints.length > 0 && (
              <div className="sidebar-block">
                <div className="sidebar-label">Registered Endpoints</div>
                {data.endpoints.slice(0, 6).map((ep) => (
                  <div key={ep.id} className="sidebar-row" style={{ alignItems: "flex-start" }}>
                    <span className="sidebar-key" style={{ color: ep.active ? "#4ade80" : "#555" }}>#{ep.id}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {ep.proxyName || ep.url}
                        </span>
                        {ep.requireWorldId && (
                          <span style={{
                            fontSize: 8, padding: "1px 4px", borderRadius: 3, flexShrink: 0,
                            background: `${net.color}15`, border: `1px solid ${net.color}33`, color: net.color,
                            fontWeight: 700,
                          }}>WID</span>
                        )}
                      </div>
                      <div style={{ fontSize: 9, color: "#444" }}>${ep.pricePerCall}/call · {ep.totalCalls} calls</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {view === "manage" && (
        <section className="panel panel-narrow">
          <div className="section-header">
            <span className="section-title">Manage Endpoint</span>
            <span className="section-sub">
              Top up your gas budget or adjust sponsorship % for an existing endpoint
            </span>
          </div>
          <ManageEndpoint networkId={activeNet} />
        </section>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="footer">
        <span>AgentGate · AI Agent Payments on Hedera</span>
        <span>{net.label} · chainId {net.chainId}</span>
      </footer>

      <style>{`
        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          max-width: 1100px;
          margin: 0 auto;
          padding: 24px 20px;
          gap: 20px;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #1a1a1a;
          padding-bottom: 16px;
        }
        .header-left { display: flex; align-items: baseline; gap: 10px; }
        .logo { font-size: 20px; font-weight: 700; color: #e5e7eb; letter-spacing: -0.5px; }
        .logo-sub { font-size: 11px; color: #444; text-transform: uppercase; letter-spacing: 0.1em; }
        .header-right { display: flex; align-items: center; gap: 12px; }
        .live-indicator {
          display: flex; align-items: center; gap: 6px;
          font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.08em;
        }
        .live-dot {
          width: 7px; height: 7px; border-radius: 50%;
          animation: pulse-live 2s ease-in-out infinite; transition: background 0.5s;
        }
        @keyframes pulse-live { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .refresh-btn {
          background: none; border: 1px solid #222; color: #555; cursor: pointer;
          font-size: 14px; padding: 4px 8px; border-radius: 4px;
          font-family: 'JetBrains Mono', monospace; transition: all 0.2s;
        }
        .refresh-btn:hover { color: #aaa; border-color: #444; }

        .tabs {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .tab {
          display: flex; align-items: center; gap: 7px;
          padding: 7px 14px; background: transparent;
          border: 1px solid #1a1a1a; border-radius: 6px;
          cursor: pointer; font-family: 'JetBrains Mono', monospace;
          font-size: 12px; color: #444; transition: all 0.2s;
        }
        .tab:hover:not(.tab-active) { border-color: #333; color: #888; }
        .tab-dot { width: 6px; height: 6px; border-radius: 50%; transition: background 0.2s; }
        .tab-chain-id { font-size: 10px; transition: color 0.2s; }

        .view-tabs {
          margin-left: auto;
          display: flex;
          gap: 4px;
        }
        .view-tab {
          padding: 6px 12px; background: transparent;
          border: 1px solid #111; border-radius: 5px;
          cursor: pointer; font-family: 'JetBrains Mono', monospace;
          font-size: 11px; color: #333; transition: all 0.2s;
        }
        .view-tab:hover:not(.view-tab-active) { color: #666; border-color: #222; }
        .view-tab-active { background: #111; }

        .main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        @media (max-width: 720px) { .main-grid { grid-template-columns: 1fr; } }

        .panel {
          background: #0d0d0d;
          border: 1px solid #1a1a1a;
          border-radius: 8px;
          padding: 20px;
        }
        .panel-full {
          width: 100%;
        }
        .panel-narrow {
          max-width: 620px;
        }
        .publish-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 860px) { .publish-grid { grid-template-columns: 1fr; } }
        .publish-sidebar {
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: sticky;
          top: 24px;
        }
        .sidebar-block {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sidebar-label {
          font-size: 9px;
          color: #444;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding-bottom: 4px;
          border-bottom: 1px solid #1a1a1a;
        }
        .sidebar-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sidebar-key {
          font-size: 10px;
          color: #555;
          min-width: 0;
          flex-shrink: 0;
        }
        .sidebar-addr {
          font-size: 10px;
          font-family: 'JetBrains Mono', monospace;
          text-decoration: none;
          margin-left: auto;
        }
        .sidebar-addr:hover { text-decoration: underline; }
        .sidebar-stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .stat-box {
          padding: 10px;
          background: #080808;
          border: 1px solid #1a1a1a;
          border-radius: 6px;
          text-align: center;
        }
        .stat-val {
          font-size: 16px;
          font-weight: 700;
          color: #888;
          font-family: 'JetBrains Mono', monospace;
        }
        .stat-key {
          font-size: 9px;
          color: #444;
          margin-top: 2px;
        }
        .sidebar-steps {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .step-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 10px;
          color: #666;
          line-height: 1.4;
        }
        .step-num {
          font-weight: 700;
          font-size: 11px;
          min-width: 14px;
          font-family: 'JetBrains Mono', monospace;
        }

        .section-header {
          margin-bottom: 20px;
          padding-bottom: 14px;
          border-bottom: 1px solid #1a1a1a;
        }
        .section-title {
          display: block;
          font-size: 15px;
          font-weight: 700;
          color: #e5e7eb;
          margin-bottom: 4px;
        }
        .section-sub {
          font-size: 11px;
          color: #555;
        }

        .footer {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #2a2a2a;
          padding-top: 8px;
          border-top: 1px solid #111;
        }
      `}</style>
    </div>
  );
}
