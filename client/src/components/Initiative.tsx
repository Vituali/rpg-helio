import { useCallback } from "react";
import type { Initiative } from "@helio/shared";
import { useGameStore } from "../state/gameStore";
import { useNetStore } from "../state/netStore";
import { send } from "../net/bridge";
import { IconSend } from "./icons";

/** Painel de iniciativa (ordem de turno).
 * O mestre define a ordem e avança a vez; todos veem quem está na vez. */
export default function Initiative({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { you, role } = useNetStore((s) => ({ you: s.you, role: s.role }));
  const isGm = role === "gm";
  const { actors, initiative, setActiveActor } = useGameStore((s) => ({
    actors: s.actors,
    initiative: s.initiative,
    setActiveActor: s.setActiveActor,
  }));

  const ini = initiative ?? { order: [], currentIndex: 0 };
  const currentId = ini.order[ini.currentIndex] ?? null;
  const actorById = new Map(actors.map((a) => [a.id, a]));

  const definirOrdem = useCallback(() => {
    if (!isGm) return;
    const ids = actors.map((a) => a.id);
    send("initiative:set", { order: ids, currentIndex: 0 });
  }, [actors, isGm]);

  const proximaVez = useCallback(() => {
    if (!isGm) return;
    send("initiative:next", undefined);
  }, [isGm]);

  if (!open) return null;

  return (
    <div
      className="vtt-initiative"
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        width: 300,
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
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
          Iniciativa
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
          ✕
        </button>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {!isGm && (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            A ordem de turno é definida pelo mestre.
          </div>
        )}

        {ini.order.length === 0 && (
          <div style={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic", textAlign: "center", marginTop: 10 }}>
            Sem ordem de turno definida.
          </div>
        )}

        {ini.order.map((actorId: string, i: number) => {
          const actor = actorById.get(actorId);
          const isCurrent = actorId === currentId;
          const isMine = actor?.ownerId === you || (!isGm && actorId === currentId);
          return (
            <div
              key={actorId}
              onClick={() => setActiveActor(actorId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
                background: isCurrent
                  ? "rgba(217, 119, 6, 0.2)"
                  : "rgba(30, 41, 59, 0.5)",
                border: `1px solid ${
                  isCurrent ? "#fbbf24" : isMine ? "rgba(34, 197, 94, 0.4)" : "rgba(71, 85, 105, 0.2)"
                }`,
                color: isCurrent ? "#fbbf24" : "#e2e8f0",
                fontWeight: isCurrent ? 700 : 400,
              }}
            >
              <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 20, textAlign: "center" }}>
                #{i + 1}
              </span>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: actor?.color || "#64748b",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {actor?.name.slice(0, 2).toUpperCase()}
              </span>
              <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                {actor?.name ?? "Desconhecido"}
              </span>
              {isCurrent && (
                <span
                  style={{
                    fontSize: 10,
                    color: "#fbbf24",
                    background: "rgba(217, 119, 6, 0.15)",
                    border: "1px solid rgba(217, 119, 6, 0.35)",
                    borderRadius: 4,
                    padding: "1px 6px",
                  }}
                >
                  VEZ
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isGm && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(217, 119, 6, 0.2)", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={definirOrdem}
            disabled={actors.length === 0}
            style={{
              background: "#475569",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              padding: "6px 12px",
              fontSize: 12,
              cursor: actors.length === 0 ? "default" : "pointer",
            }}
          >
            Definir ordem
          </button>
          <button
            type="button"
            onClick={proximaVez}
            disabled={ini.order.length === 0}
            style={{
              background: ini.order.length === 0 ? "#475569" : "#d97706",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              padding: "6px 14px",
              fontSize: 12,
              cursor: ini.order.length === 0 ? "default" : "pointer",
            }}
          >
            <IconSend size={14} style={{ marginRight: 6 }} />
            Próxima vez
          </button>
        </div>
      )}
    </div>
  );
}
