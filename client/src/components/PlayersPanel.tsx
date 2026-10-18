import { send } from "../net/bridge";
import { useGameStore } from "../state/gameStore";
import { useNetStore } from "../state/netStore";

/**
 * Painel da mesa: quem está na sala e quem pode andar.
 *
 * Aqui mora a permissão de movimento — o mestre libera o jogador, e o
 * servidor é quem faz valer (docs/DECISOES.md #1).
 */
export default function PlayersPanel() {
  const status = useNetStore((s) => s.status);
  const code = useNetStore((s) => s.code);
  const you = useNetStore((s) => s.you);
  const role = useNetStore((s) => s.role);
  const players = useNetStore((s) => s.players);
  const actors = useGameStore((s) => s.actors);

  const st = {
    head: {
      color: "#a78bfa",
      fontSize: 11,
      fontWeight: "bold" as const,
      letterSpacing: 0.5,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottom: "1px solid #2d2040",
      paddingBottom: 3,
      marginBottom: 6,
    },
    body: { display: "flex", flexDirection: "column" as const, gap: 6 },
    empty: { color: "#5a4d7a", fontSize: 10, lineHeight: 1.5 },
    row: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 6,
      background: "#130f22",
      border: "1px solid #2d2040",
      borderRadius: 6,
      padding: "5px 7px",
    },
    name: { fontSize: 12, color: "#e5e0f5", display: "flex", alignItems: "center", gap: 5 },
    tag: (on: boolean) => ({
      fontSize: 9,
      padding: "1px 5px",
      borderRadius: 999,
      border: `1px solid ${on ? "#7c3aed" : "#3d2b60"}`,
      background: on ? "#2d1f4e" : "transparent",
      color: on ? "#c4b5fd" : "#7c6aaa",
    }),
    perm: (on: boolean) => ({
      fontSize: 10,
      padding: "3px 7px",
      borderRadius: 5,
      cursor: "pointer",
      border: `1px solid ${on ? "#16a34a" : "#7f1d1d"}`,
      background: on ? "#052e16" : "#2a0f0f",
      color: on ? "#86efac" : "#fca5a5",
      whiteSpace: "nowrap" as const,
    }),
    bulk: {
      fontSize: 10,
      padding: "3px 8px",
      borderRadius: 5,
      cursor: "pointer",
      border: "1px solid #3d2b60",
      background: "#0d0b14",
      color: "#9d8fc4",
    },
    dot: (on: boolean) => ({
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: on ? "#22c55e" : "#6b7280",
      display: "inline-block",
    }),
  };

  if (status !== "online") {
    return (
      <div>
        <div style={st.head}>👥 MESA</div>
        <div style={st.body}>
          <div style={st.empty}>
            Modo local — sem servidor. O mapa fica só neste computador.
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

  return (
    <div>
      <div style={st.head}>
        <span>
          👥 MESA <span style={{ color: "#7c6aaa", fontWeight: "normal" }}>· {code}</span>
        </span>
        <span style={st.tag(isGm)}>{isGm ? "MESTRE" : "JOGADOR"}</span>
      </div>

      <div style={st.body}>
        {list.map((p) => {
          const actor = p.actorId ? actors.find((a) => a.id === p.actorId) : undefined;
          const isMe = p.id === you;
          return (
            <div key={p.id} style={st.row}>
              <span style={st.name}>
                <span style={st.dot(isMe)} title={isMe ? "você" : "conectado"} />
                <span>
                  {p.name}
                  {actor ? (
                    <span style={{ color: "#7c6aaa", fontSize: 10 }}> · {actor.name}</span>
                  ) : null}
                </span>
                {p.role === "gm" && <span style={st.tag(true)}>mestre</span>}
              </span>

              {isGm && p.role === "player" ? (
                <button
                  style={st.perm(p.canMoveGlobal)}
                  title="Liberar ou travar o movimento deste jogador"
                  onClick={() => setPerm(p.id, !p.canMoveGlobal)}
                >
                  {p.canMoveGlobal ? "🚶 pode andar" : "🔒 travado"}
                </button>
              ) : (
                p.role === "player" && (
                  <span style={st.tag(p.canMoveGlobal)}>
                    {p.canMoveGlobal ? "pode andar" : "travado"}
                  </span>
                )
              )}
            </div>
          );
        })}

        {isGm && others.length > 0 && (
          <div style={{ display: "flex", gap: 6 }}>
            <button style={st.bulk} onClick={() => others.forEach((p) => setPerm(p.id, true))}>
              🔓 Liberar todos
            </button>
            <button style={st.bulk} onClick={() => others.forEach((p) => setPerm(p.id, false))}>
              🔒 Travar todos
            </button>
          </div>
        )}

        {isGm && others.length === 0 && (
          <div style={st.empty}>
            Ninguém entrou ainda. Mande o código <b>{code}</b> e o endereço desta página
            para o grupo.
          </div>
        )}
      </div>
    </div>
  );
}
