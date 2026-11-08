import { useState } from "react";
import { useNetStore } from "../state/netStore";
import { sendChat } from "../net/socket";
import { IconSend, IconChat } from "./icons";

/** Painel de chat da mesa. Qualquer jogador pode enviar; todos veem. */
export default function Chat({ open, onClose }: { open: boolean; onClose?: () => void }) {
  const { messages, you, role } = useNetStore((s) => ({
    messages: s.messages,
    you: s.you,
    role: s.role,
  }));
  const [text, setText] = useState("");

  const isMine = (authorId: string | null) => authorId === you;
  const isGm = role === "gm";

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendChat(t);
    setText("");
  };

  if (!open) return null;

  return (
    <div
      className="vtt-chat"
      style={{
        position: "fixed",
        bottom: 10,
        right: 10,
        width: 320,
        height: 260,
        background: "rgba(15, 12, 24, 0.92)",
        border: "1px solid rgba(217, 119, 6, 0.35)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        color: "#eae8f2",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        zIndex: 50,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid rgba(217, 119, 6, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <IconChat size={14} style={{ color: "#d97706" }} />
          <span style={{ fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Chat da Mesa
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 2,
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {messages.map((m) => {
          const mine = isMine(m.author);
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "88%",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 6,
                  fontSize: 11,
                  color: "#94a3b8",
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: mine ? "#86efac" : isGm ? "#fca5a5" : "#e2e8f0",
                  }}
                >
                  {m.author}
                </span>
                {m.role === "gm" && (
                  <span
                    style={{
                      background: "rgba(251, 146, 60, 0.15)",
                      color: "#fb923c",
                      border: "1px solid rgba(251, 146, 60, 0.35)",
                      borderRadius: 4,
                      padding: "0 4px",
                      fontSize: 10,
                    }}
                  >
                    MESTRE
                  </span>
                )}
                <span
                  style={{
                    color: "#64748b",
                    fontSize: 10,
                  }}
                >
                  {new Date(m.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div
                style={{
                  background: mine
                    ? "rgba(34, 197, 94, 0.18)"
                    : "rgba(30, 41, 59, 0.6)",
                  border: `1px solid ${mine ? "rgba(34, 197, 94, 0.4)" : "rgba(71, 85, 105, 0.4)"}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  color: "#f1f5f9",
                  fontSize: 13,
                  lineHeight: 1.4,
                  wordWrap: "break-word",
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      <form onSubmit={enviar} style={{ padding: "8px 12px", borderTop: "1px solid rgba(217, 119, 6, 0.2)" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Digite uma mensagem…"
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              background: "rgba(30, 41, 59, 0.6)",
              border: "1px solid rgba(71, 85, 105, 0.4)",
              borderRadius: 6,
              color: "#f1f5f9",
              padding: "6px 10px",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={!text.trim()}
            style={{
              background: text.trim() ? "#d97706" : "#475569",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              padding: "0 14px",
              fontSize: 13,
              cursor: text.trim() ? "pointer" : "default",
            }}
          >
            <IconSend size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
