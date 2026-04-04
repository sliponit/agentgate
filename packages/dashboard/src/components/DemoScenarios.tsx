import type { CSSProperties } from "react";
import { NetworkId, NETWORKS } from "../lib/chains";

type ScenarioId = "vacation" | "article";

interface Props {
  networkId: NetworkId;
  onChoose: (id: ScenarioId) => void;
}

/**
 * Sponsor-facing demo stories: idle API resale (proxy) + pay-per-article content.
 */
export function DemoScenarios({ networkId, onChoose }: Props) {
  const net = NETWORKS[networkId];

  const cardBase: CSSProperties = {
    background: "#0a0a0a",
    border: "1px solid #1c1c1c",
    borderRadius: 10,
    padding: "18px 18px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  return (
    <section
      style={{
        background: "linear-gradient(180deg, #0d0d0d 0%, #0a0a0a 100%)",
        border: "1px solid #1a1a1a",
        borderRadius: 10,
        padding: "22px 22px 20px",
        marginBottom: 4,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: net.color,
            marginBottom: 6,
            fontWeight: 700,
          }}
        >
          Demo story · for judges & sponsors
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 700,
            color: "#e5e7eb",
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
          }}
        >
          Real problems agents can pay for — in HBAR, on Hedera
        </h2>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#666", lineHeight: 1.55, maxWidth: 720 }}>
          Pick a preset to jump to <strong style={{ color: "#888" }}>Publish</strong> with fields pre-filled.
          You still connect your wallet and run a quick endpoint test before going on-chain.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
        className="demo-scenarios-grid"
      >
        {/* ── Vacation / idle subscription ───────────────────────────── */}
        <article
          style={{
            ...cardBase,
            borderColor: `${net.color}33`,
            boxShadow: `inset 0 0 0 1px ${net.color}08`,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>🏖️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e5e7eb" }}>
                Away for two weeks — monetize a subscription you already pay for
              </h3>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#777", lineHeight: 1.55 }}>
                You have Claude, Gemini, or another API on a monthly plan. While you are on holiday, that
                quota sits unused. Turn on <strong style={{ color: "#999" }}>Proxy mode</strong>: agents pay
                you per call in HBAR; your key stays on the server and never ships to clients.
              </p>
            </div>
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 10,
              color: "#555",
              lineHeight: 1.7,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <li>Register + optional gas budget on {net.label}</li>
            <li>Point proxy at your provider&apos;s HTTP API</li>
            <li>Share <code style={{ color: net.color }}>/api/proxy/&lt;id&gt;</code> — x402 + WorldID gate the traffic</li>
          </ol>
          <button
            type="button"
            onClick={() => onChoose("vacation")}
            style={{
              marginTop: "auto",
              padding: "10px 14px",
              borderRadius: 6,
              border: `1px solid ${net.color}`,
              background: `${net.color}18`,
              color: net.color,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              alignSelf: "flex-start",
            }}
          >
            Use this flow →
          </button>
        </article>

        {/* ── Pay per article ─────────────────────────────────────────── */}
        <article style={cardBase}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>📰</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#e5e7eb" }}>
                Pay-per-article — newsroom or independent blog
              </h3>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#777", lineHeight: 1.55 }}>
                Expose each article as a URL (or your CMS JSON). One <strong style={{ color: "#999" }}>GET</strong>{" "}
                = one micropayment: reader (or their agent) pays in HBAR before the body loads. No card vault,
                no account wall — just x402 and a human-verified agent policy if you want it.
              </p>
            </div>
          </div>
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 10,
              color: "#555",
              lineHeight: 1.7,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <li>Publish your article endpoint URL (JSON or HTML)</li>
            <li>Set price per call (e.g. a few cents in USD → HBAR)</li>
            <li>Integrate 402 handling in the reader app or agent</li>
          </ol>
          <button
            type="button"
            onClick={() => onChoose("article")}
            style={{
              marginTop: "auto",
              padding: "10px 14px",
              borderRadius: 6,
              border: "1px solid #333",
              background: "#111",
              color: "#aaa",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              alignSelf: "flex-start",
            }}
          >
            Use this flow →
          </button>
        </article>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .demo-scenarios-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
