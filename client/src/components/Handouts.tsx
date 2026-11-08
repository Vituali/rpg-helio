import { useCallback, useState } from "react";
import type { Handout } from "@helio/shared";
import { useGameStore } from "../state/gameStore";
import { useNetStore } from "../state/netStore";
import { send } from "../net/bridge";
import { IconClose, IconSend } from "./icons";

/** Painel de handouts (documentos/pistas entregues pelo mestre).
 * Jogadores veem apenas os seus; o mestre vê todos e pode criar novos. */
export default function Handouts({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { you, role } = useNetStore((s) => ({ you: s.you, role: s.role }));
  const isGm = role === "gm";
  const [sceneHandouts, setSceneHandouts] = useState<Handout[]>([]);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftTo, setDraftTo] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handouts = useCallback(() => {
    if (!sceneHandouts.length) return [];
    if (isGm) return sceneHandouts;
    return sceneHandouts.filter((h) => h.to.includes(you ?? ""));
  }, [sceneHandouts, isGm, you]);

  // Atualiza a lista quando a cena muda
  const { handouts: sHandouts } = useGameStore((s) => ({
    handouts: s.handouts ?? [],
  }));
  useCallback(() => {
    setSceneHandouts(sHandouts);
  }, [sHandouts])();

  const criar = () => {
    if (!draftTitle.trim() || !draftContent.trim()) return;
    setSaving(true);
    send("handout:create", {
      title: draftTitle.trim(),
      content: draftContent.trim(),
      to: draftTo.length > 0 ? draftTo : [you ?? ""],
    });
    setDraftTitle("");
    setDraftContent("");
    setDraftTo([]);
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div
      className="vtt-handouts"
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        width: 360,
        maxHeight: "85vh",
        background: "rgba(15, 12, 24, 0.94)",
        border: "1px solid rgba(217, 119, 6, 0.35)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        color: "#eae8f2",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(217, 119, 6, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
            Documentos da Mesa
          </span>
        </div>
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
          <IconClose size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
        {isGm ? (
          <>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
              Crie um documento e escolha quem pode lê-lo. Deixe os destinatários
              vazios para enviar apenas a você mesmo.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>
                Título
              </label>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Título do documento…"
                disabled={saving}
                style={{
                  background: "rgba(30, 41, 59, 0.5)",
                  border: "1px solid rgba(71, 85, 105, 0.3)",
                  borderRadius: 6,
                  color: "#f1f5f9",
                  padding: "6px 10px",
                  fontSize: 13,
                  outline: "none",
                }}
              />
              <label style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>
                Conteúdo
              </label>
              <textarea
                value={draftContent}
                onChange={(e) => setDraftContent(e.target.value)}
                placeholder="Escreva a pista, carta ou documento…"
                rows={4}
                disabled={saving}
                style={{
                  background: "rgba(30, 41, 59, 0.5)",
                  border: "1px solid rgba(71, 85, 105, 0.3)",
                  borderRadius: 6,
                  color: "#f1f5f9",
                  padding: "6px 10px",
                  fontSize: 13,
                  outline: "none",
                  resize: "vertical",
                }}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, marginBottom: 4 }}>
                Destinatários (nomes de jogadores, separados por vírgula):
              </div>
              <input
                type="text"
                value={draftTo.join(", ")}
                onChange={(e) =>
                  setDraftTo(e.target.value.split(",").map((t) => t.trim()).filter(Boolean))
                }
                placeholder="agente-teste, outro-jogador"
                disabled={saving}
                style={{
                  background: "rgba(30, 41, 59, 0.5)",
                  border: "1px solid rgba(71, 85, 105, 0.3)",
                  borderRadius: 6,
                  color: "#f1f5f9",
                  padding: "6px 10px",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </div>
            <button
              type="button"
              onClick={criar}
              disabled={saving || !draftTitle.trim() || !draftContent.trim()}
              style={{
                background: saving ? "#475569" : "#d97706",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                padding: "8px 16px",
                fontSize: 13,
                cursor: saving || !draftTitle.trim() || !draftContent.trim() ? "default" : "pointer",
              }}
            >
              <IconSend size={14} style={{ marginRight: 6 }} />
              {saving ? "Enviando…" : "Criar documento"}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            Documentos entregues a você pelo mestre.
          </div>
        )}

        {handouts().length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic", textAlign: "center", marginTop: 20 }}>
            Sem documentos por enquanto.
          </div>
        )}

        {handouts().map((h) => (
          <div
            key={h.id}
            style={{
              background: "rgba(30, 41, 59, 0.6)",
              border: `1px solid ${isGm ? "rgba(217, 119, 6, 0.3)" : "rgba(71, 85, 105, 0.3)"}`,
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 10,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#fbbf24" }}>
                {h.title}
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: "#94a3b8",
                  background: "rgba(71, 85, 105, 0.3)",
                  borderRadius: 4,
                  padding: "1px 6px",
                }}
              >
                {h.to.length} destinatário(s)
              </span>
            </div>
            <div
              style={{
                fontSize: 13,
                color: "#e2e8f0",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {h.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
