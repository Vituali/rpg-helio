import { useNetStore } from "../state/netStore";
import { IconAlert } from "./icons";

/** Aviso passageiro do servidor (movimento negado, jogador não autorizado…). */
export default function Notice() {
  const notice = useNetStore((s) => s.notice);
  if (!notice) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 68,
        left: "50%",
        transform: "translateX(-50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 9,
        background: "linear-gradient(135deg, rgba(69, 10, 10, 0.94) 0%, rgba(36, 6, 16, 0.96) 100%)",
        border: "1px solid rgba(248, 113, 113, 0.65)",
        color: "#fecaca",
        padding: "10px 18px",
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.03em",
        zIndex: 10001,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.75), 0 0 20px rgba(220, 38, 38, 0.35)",
        pointerEvents: "none",
        animation: "toastIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        maxWidth: "90vw",
      }}
    >
      <IconAlert size={16} style={{ color: "#f87171", flexShrink: 0 }} />
      <span>{notice}</span>
    </div>
  );
}
