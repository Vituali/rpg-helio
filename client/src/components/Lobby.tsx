import { useState } from "react";
import type { Role } from "@helio/shared";
import { connect } from "../net/socket";
import { useNetStore } from "../state/netStore";

/** Onde a senha de mestre fica guardada neste navegador (para não digitar sempre). */
const GMKEY_STORAGE = "helio.gmkey";

/**
 * Tela de entrada. Só aparece enquanto ninguém entrou numa sala.
 *
 * Jogador entra com o código e recebe um token próprio. Mestre só entra com a
 * senha do servidor (`GM_KEY`), que é o que impede um estranho que achou a URL
 * pública de assumir a mesa.
 */
export default function Lobby({ onLocal }: { onLocal: () => void }) {
  const status = useNetStore((s) => s.status);
  const notice = useNetStore((s) => s.notice);
  const serverUrl = useNetStore((s) => s.serverUrl);

  const [url, setUrl] = useState(serverUrl);
  const [code, setCode] = useState("HELIO");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("gm");
  const [gmKey, setGmKey] = useState(() => localStorage.getItem(GMKEY_STORAGE) ?? "");

  const connecting = status === "connecting";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (role === "gm") localStorage.setItem(GMKEY_STORAGE, gmKey);
    connect({
      url,
      code: code.trim() || "HELIO",
      name: name.trim(),
      role,
      key: role === "gm" ? gmKey : "",
    });
  };

  const styles = {
    wrap: {
      position: "fixed" as const,
      inset: 0,
      background: "rgba(6,4,12,0.88)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10000,
    },
    box: {
      background: "#150f28",
      border: "1px solid #7c3aed",
      borderRadius: 12,
      padding: 26,
      width: 340,
      display: "flex",
      flexDirection: "column" as const,
      gap: 12,
      fontFamily: "system-ui, sans-serif",
      color: "#e5e0f5",
      boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
    },
    title: { fontSize: 20, fontWeight: "bold" as const, color: "#a78bfa" },
    sub: { fontSize: 11, color: "#8b7cb5", lineHeight: 1.5 },
    label: { fontSize: 11, color: "#a99bc9", marginBottom: 2, display: "block" },
    input: {
      width: "100%",
      background: "#0d0b14",
      border: "1px solid #3d2b60",
      borderRadius: 6,
      color: "#e5e0f5",
      padding: "7px 9px",
      fontSize: 13,
      boxSizing: "border-box" as const,
    },
    row: { display: "flex", gap: 8 },
    roleBtn: (on: boolean) => ({
      flex: 1,
      padding: "8px 6px",
      borderRadius: 6,
      cursor: "pointer",
      fontSize: 12,
      border: `1px solid ${on ? "#7c3aed" : "#3d2b60"}`,
      background: on ? "#3b2a63" : "#0d0b14",
      color: on ? "#fff" : "#9d8fc4",
    }),
    primary: {
      width: "100%",
      padding: "10px",
      borderRadius: 6,
      border: "1px solid #7c3aed",
      background: "#7c3aed",
      color: "#fff",
      fontWeight: "bold" as const,
      fontSize: 13,
      cursor: "pointer",
    },
    ghost: {
      width: "100%",
      padding: "8px",
      borderRadius: 6,
      border: "1px solid #3d2b60",
      background: "transparent",
      color: "#9d8fc4",
      fontSize: 12,
      cursor: "pointer",
    },
    err: {
      fontSize: 11,
      color: "#fca5a5",
      background: "#3b1111",
      border: "1px solid #7f1d1d",
      borderRadius: 6,
      padding: "6px 8px",
    },
    ok: { fontSize: 11, color: "#86efac" },
  };

  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div style={styles.wrap}>
      <form style={styles.box} onSubmit={submit}>
        <div>
          <div style={styles.title}>☽ HELIO</div>
          <div style={styles.sub}>
            Mesa virtual. Quem cria a sala narra; os outros entram com o código.
          </div>
        </div>

        <div>
          <label style={styles.label}>Seu nome</label>
          <input
            style={styles.input}
            value={name}
            placeholder="Como o grupo te chama"
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label style={styles.label}>Código da sala</label>
          <input
            style={styles.input}
            value={code}
            maxLength={24}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <div style={{ ...styles.sub, marginTop: 4 }}>
            Combine um código com o grupo. É ele que junta todo mundo no mesmo mapa.
          </div>
        </div>

        <div>
          <label style={styles.label}>Você é</label>
          <div style={styles.row}>
            <button
              type="button"
              style={styles.roleBtn(role === "gm")}
              onClick={() => setRole("gm")}
            >
              👁 Mestre
            </button>
            <button
              type="button"
              style={styles.roleBtn(role === "player")}
              onClick={() => setRole("player")}
            >
              ⚔ Jogador
            </button>
          </div>
        </div>

        {role === "gm" && (
          <div>
            <label style={styles.label}>Senha de mestre</label>
            <input
              style={styles.input}
              type="password"
              value={gmKey}
              maxLength={64}
              placeholder="a que foi definida no servidor"
              onChange={(e) => setGmKey(e.target.value)}
            />
            <div style={{ ...styles.sub, marginTop: 4 }}>
              Fica guardada neste navegador. Jogador não precisa de senha.
            </div>
          </div>
        )}

        <button type="button" style={styles.ghost} onClick={() => setShowAdvanced((p) => !p)}>
          {showAdvanced ? "▲" : "▼"} Servidor
        </button>

        {showAdvanced && (
          <div>
            <label style={styles.label}>Endereço do servidor</label>
            <input
              style={styles.input}
              value={url}
              placeholder="vazio = esta mesma página"
              onChange={(e) => setUrl(e.target.value)}
            />
            <div style={{ ...styles.sub, marginTop: 4 }}>
              Deixe vazio para jogar no mesmo endereço que abriu esta página.
            </div>
          </div>
        )}

        {notice && <div style={styles.err}>{notice}</div>}
        {connecting && <div style={styles.ok}>Conectando…</div>}

        <button type="submit" style={styles.primary} disabled={connecting}>
          {connecting ? "Entrando…" : "Entrar na sala"}
        </button>

        <button type="button" style={styles.ghost} onClick={onLocal}>
          Preparar o mapa sozinho (sem servidor)
        </button>
      </form>
    </div>
  );
}
