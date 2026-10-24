import type { CSSProperties, ReactNode } from "react";
import { IconSigil, OccultMandala } from "../components/icons";

/**
 * Moldura das páginas de entrada (ADR #21).
 *
 * O visual é o mesmo do antigo lobby de propósito: a tela se dividiu, a
 * identidade não. O que mudou é o que cabe dentro — **uma pergunta por página**.
 * A trilha no topo diz onde a pessoa está e quantos passos faltam, que é a
 * informação que a tela única não conseguia dar.
 */
export default function Shell({
  step,
  title,
  subtitle,
  children,
}: {
  step: 1 | 2;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background:
          "radial-gradient(circle at 50% 35%, rgba(46, 16, 101, 0.48) 0%, rgba(10, 5, 22, 0.94) 55%, rgba(4, 2, 9, 0.98) 100%)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        zIndex: 10000,
        overflowY: "auto",
      }}
    >
      <OccultMandala
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          width: "min(680px, 130vw)",
          height: "min(680px, 130vw)",
          color: "#a855f7",
          pointerEvents: "none",
          animation: "sigilRotate 95s linear infinite, sigilPulse 6s ease-in-out infinite",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 430,
          background:
            "linear-gradient(165deg, rgba(22, 13, 42, 0.95) 0%, rgba(11, 7, 23, 0.98) 100%)",
          border: "1px solid rgba(217, 119, 6, 0.45)",
          borderRadius: 16,
          padding: "28px 24px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 15,
          color: "#f3effb",
          boxShadow:
            "0 24px 80px rgba(0, 0, 0, 0.85), 0 0 40px rgba(147, 51, 234, 0.22), inset 0 1px 0 rgba(253, 230, 138, 0.18)",
        }}
      >
        {/* Cantos ornamentais dourados */}
        <Ornament style={{ top: 7, left: 7 }} />
        <Ornament style={{ top: 7, right: 7, transform: "scaleX(-1)" }} />

        {/* Cabeçalho ritualístico */}
        <div style={{ textAlign: "center", marginBottom: 2 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 54,
              height: 54,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(147, 51, 234, 0.32) 0%, rgba(15, 9, 30, 0.9) 75%)",
              border: "1px solid rgba(245, 158, 11, 0.55)",
              color: "#fbbf24",
              marginBottom: 10,
              boxShadow: "0 0 24px rgba(168, 85, 247, 0.4)",
              animation: "floatSlow 4s ease-in-out infinite",
            }}
          >
            <IconSigil size={32} />
          </div>

          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "0.22em",
              background: "linear-gradient(135deg, #fef3c7 0%, #f59e0b 45%, #c084fc 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              lineHeight: 1.15,
            }}
          >
            HELIO
          </div>

          <div
            style={{
              fontSize: 10,
              fontFamily: "var(--font-display)",
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: "#c084fc",
              marginTop: 2,
              marginBottom: 10,
            }}
          >
            Membrana · Mesa Paranormal
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 6,
              marginBottom: 12,
            }}
          >
            <Step n={1} label="Conta" active={step === 1} done={step > 1} />
            <span style={{ color: "#4c3a70", fontSize: 11 }}>→</span>
            <Step n={2} label="Missão" active={step === 2} done={false} />
          </div>

          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#fde68a",
              marginBottom: 5,
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 12, color: "#9d8ec4", lineHeight: 1.45 }}>{subtitle}</div>
        </div>

        {children}
      </div>
    </div>
  );
}

function Ornament({ style }: { style: CSSProperties }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      style={{ position: "absolute", color: "#f59e0b", opacity: 0.7, ...style }}
    >
      <path d="M1 15V3a2 2 0 0 1 2-2h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="4" cy="4" r="1.5" fill="currentColor" />
    </svg>
  );
}

function Step({
  n,
  label,
  active,
  done,
}: {
  n: number;
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: 999,
        border: `1px solid ${
          active ? "rgba(245, 158, 11, 0.65)" : "rgba(139, 92, 246, 0.22)"
        }`,
        background: active ? "rgba(245, 158, 11, 0.12)" : "transparent",
        color: active ? "#fde68a" : done ? "#a78bfa" : "#7e6ea8",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: `1px solid ${active ? "#f59e0b" : "currentColor"}`,
          fontSize: 9,
          lineHeight: 1,
        }}
      >
        {done ? "✓" : n}
      </span>
      {label}
    </span>
  );
}
