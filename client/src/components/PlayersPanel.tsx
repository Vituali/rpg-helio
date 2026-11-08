import { useState } from "react";
import type { Role } from "@helio/shared";
import { setMemberRole } from "../net/auth";
import { send } from "../net/bridge";
import { useGameStore } from "../state/gameStore";
import { flashNotice, useNetStore } from "../state/netStore";
import {
  IconEye,
  IconLock,
  IconSwords,
  IconUnlock,
  IconUsers,
  IconWalk,
} from "./icons";

/**
 * Painel da mesa: quem está na sala e quem pode andar.
 *
 * Aqui mora a permissão de movimento — o mestre libera o jogador, e o
 * servidor é quem faz valer (docs/DECISOES.md #1).
 */
export default function PlayersPanel() {
  const status = useNetStore((s) => s.status);
  const code = useNetStore((s) => s.code);
  const mission = useNetStore((s) => s.mission);
  const you = useNetStore((s) => s.you);
  const role = useNetStore((s) => s.role);
  const players = useNetStore((s) => s.players);
  const actors = useGameStore((s) => s.actors);
  /** Nome da conta cujo papel está sendo gravado (para não clicar duas vezes). */
  const [papelBusy, setPapelBusy] = useState<string | null>(null);

  if (status !== "online") {
    return (
      <div className="vtt-section">
        <div className="vtt-section-head" style={{ cursor: "default" }}>
          <span className="vtt-section-title">
            <IconUsers size={14} style={{ color: "#c084fc" }} />
            <span>MESA</span>
          </span>
          <span
            style={{
              fontSize: 9,
              padding: "2px 7px",
              borderRadius: 999,
              border: "1px solid rgba(139, 92, 246, 0.3)",
              color: "#9d8ec4",
              fontFamily: "var(--font-body)",
            }}
          >
            SOLO
          </span>
        </div>
        <div className="vtt-section-body">
          <div style={{ color: "#8474a8", fontSize: 11, lineHeight: 1.5 }}>
            Modo de preparação local — sem servidor ativo. As alterações ficam neste dispositivo.
          </div>
        </div>
      </div>
    );
  }

  const isGm = role === "gm";
  const list = [...players].sort((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name) : a.role === "gm" ? -1 : 1,
  );
  const others = players.filter((p) => p.role === "player");

  const setPerm = (playerId: string, canMoveGlobal: boolean) =>
    send("perm:set", { playerId, canMoveGlobal });

  /**
   * Dá ou tira o papel de mestre de uma conta nesta missão (ADR #22).
   *
   * Vai por HTTP porque grava vínculo (é administração, não cena), e o servidor
   * faz valer na hora: o painel do outro lado se atualiza pelo próximo
   * `room:state`, sem F5.
   */
  const mudarPapel = async (name: string, next: Role) => {
    if (!code || papelBusy !== null) return;
    setPapelBusy(name);
    const result = await setMemberRole(code, name, next);
    setPapelBusy(null);
    if (!result.ok) flashNotice(result.error ?? "Não foi possível mudar o papel.");
  };

  return (
    <div className="vtt-section">
      <div className="vtt-section-head" style={{ cursor: "default" }}>
        <span className="vtt-section-title">
          <IconUsers size={14} style={{ color: "#fbbf24" }} />
          <span>
            MESA{" "}
            <span
              style={{
                color: "#fde68a",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                fontSize: 11,
              }}
              title={`Selo: ${code ?? "?"}`}
            >
              · {mission ?? code}
            </span>
          </span>
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 9,
            fontFamily: "var(--font-body)",
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "2px 7px",
            borderRadius: 999,
            border: `1px solid ${isGm ? "#f59e0b" : "#a855f7"}`,
            background: isGm ? "rgba(180, 83, 9, 0.25)" : "rgba(126, 34, 206, 0.25)",
            color: isGm ? "#fef3c7" : "#e9d5ff",
          }}
        >
          {isGm ? <IconEye size={11} /> : <IconSwords size={11} />}
          {isGm ? "MESTRE" : "AGENTE"}
        </span>
      </div>

      <div
        className="vtt-section-body"
        style={{ display: "flex", flexDirection: "column", gap: 7 }}
      >
        {list.map((p) => {
          const actor = p.actorId ? actors.find((a) => a.id === p.actorId) : undefined;
          const isMe = p.id === you;
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 6,
                background: "rgba(20, 12, 36, 0.82)",
                border: `1px solid ${
                  isMe ? "rgba(168, 85, 247, 0.45)" : "rgba(139, 92, 246, 0.18)"
                }`,
                borderRadius: 8,
                padding: "6px 8px",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "#f3effb",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  title={isMe ? "Você" : "Conectado"}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: isMe ? "#22c55e" : "#a855f7",
                    boxShadow: isMe
                      ? "0 0 8px rgba(34, 197, 94, 0.8)"
                      : "0 0 6px rgba(168, 85, 247, 0.6)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isMe ? 600 : 500,
                  }}
                >
                  {p.name}
                  {actor ? (
                    <span style={{ color: "#9d8ec4", fontSize: 11, fontWeight: 400 }}>
                      {" "}
                      · {actor.name}
                    </span>
                  ) : (
                    <span style={{ color: "#ef4444", fontSize: 10, fontStyle: "italic" }}>
                      {" "}
                      (sem token)
                    </span>
                  )}
                </span>
                {p.role === "gm" && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: "1px 6px",
                      borderRadius: 999,
                      border: "1px solid rgba(245, 158, 11, 0.5)",
                      background: "rgba(180, 83, 9, 0.2)",
                      color: "#fde68a",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    mestre
                  </span>
                )}
              </span>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  flexShrink: 0,
                }}
              >
                {isGm && p.role === "player" ? (
                  <button
                    type="button"
                    title="Liberar ou travar o movimento deste agente"
                    onClick={() => setPerm(p.id, !p.canMoveGlobal)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "4px 8px",
                      borderRadius: 6,
                      cursor: "pointer",
                      border: `1px solid ${
                        p.canMoveGlobal ? "rgba(34, 197, 94, 0.55)" : "rgba(220, 38, 38, 0.55)"
                      }`,
                      background: p.canMoveGlobal
                        ? "rgba(5, 46, 22, 0.85)"
                        : "rgba(69, 10, 10, 0.85)",
                      color: p.canMoveGlobal ? "#86efac" : "#fca5a5",
                      whiteSpace: "nowrap",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {p.canMoveGlobal ? <IconWalk size={13} /> : <IconLock size={12} />}
                    {p.canMoveGlobal ? "Livre" : "Travado"}
                  </button>
                ) : (
                  p.role === "player" && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 7px",
                        borderRadius: 999,
                        border: `1px solid ${
                          p.canMoveGlobal
                            ? "rgba(34, 197, 94, 0.45)"
                            : "rgba(220, 38, 38, 0.45)"
                        }`,
                        background: p.canMoveGlobal
                          ? "rgba(5, 46, 22, 0.5)"
                          : "rgba(69, 10, 10, 0.5)",
                        color: p.canMoveGlobal ? "#86efac" : "#fca5a5",
                      }}
                    >
                      {p.canMoveGlobal ? <IconWalk size={11} /> : <IconLock size={11} />}
                      {p.canMoveGlobal ? "livre" : "travado"}
                    </span>
                  )
                )}

                {/* Dar/tirar o papel de mestre (ADR #22). O ícone é o papel que
                    o clique concede: olho = mestre, espadas = agente. */}
                {isGm && !isMe && (
                  <button
                    type="button"
                    title={
                      p.role === "gm"
                        ? "Voltar a agente nesta missão"
                        : "Dar o papel de mestre nesta missão"
                    }
                    disabled={papelBusy === p.name}
                    onClick={() =>
                      void mudarPapel(p.name, p.role === "gm" ? "player" : "gm")
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 24,
                      height: 24,
                      padding: 0,
                      borderRadius: 6,
                      cursor: papelBusy === p.name ? "wait" : "pointer",
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      background: "rgba(12, 8, 24, 0.8)",
                      color: p.role === "gm" ? "#a78bfa" : "#fbbf24",
                      opacity: papelBusy === p.name ? 0.5 : 1,
                    }}
                  >
                    {p.role === "gm" ? <IconSwords size={12} /> : <IconEye size={13} />}
                  </button>
                )}
              </span>
            </div>
          );
        })}

        {isGm && others.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 2 }}>
            <button
              type="button"
              className="occult-btn"
              style={{ fontSize: 11, padding: "5px 8px" }}
              onClick={() => others.forEach((p) => setPerm(p.id, true))}
            >
              <IconUnlock size={13} style={{ color: "#4ade80" }} />
              Liberar todos
            </button>
            <button
              type="button"
              className="occult-btn occult-btn--danger"
              style={{ fontSize: 11, padding: "5px 8px" }}
              onClick={() => others.forEach((p) => setPerm(p.id, false))}
            >
              <IconLock size={13} style={{ color: "#f87171" }} />
              Travar todos
            </button>
          </div>
        )}

        {isGm && others.length > 0 && (
          <div style={{ fontSize: 10, color: "#7e6ea8", lineHeight: 1.4 }}>
            O olho ao lado de um agente o torna <b>mestre</b> desta missão — vale na
            hora e nas próximas sessões.
          </div>
        )}

        {isGm && others.length === 0 && (
          <div style={{ color: "#8474a8", fontSize: 11, lineHeight: 1.5 }}>
            Nenhum agente conectado. Envie o selo{" "}
            <b style={{ color: "#fde68a", fontFamily: "var(--font-mono)" }}>{code}</b> para o
            grupo entrar.
          </div>
        )}
      </div>
    </div>
  );
}
