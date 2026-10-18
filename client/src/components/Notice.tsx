import { useNetStore } from "../state/netStore";

/** Aviso passageiro do servidor (movimento negado, jogador não autorizado…). */
export default function Notice() {
  const notice = useNetStore((s) => s.notice);
  if (!notice) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 18,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#3b1111",
        border: "1px solid #7f1d1d",
        color: "#fca5a5",
        padding: "8px 16px",
        borderRadius: 8,
        fontSize: 12,
        zIndex: 10001,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        pointerEvents: "none",
      }}
    >
      {notice}
    </div>
  );
}
