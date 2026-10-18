import { useEffect, useState } from "react";
import type { Role } from "@helio/shared";
import { connect } from "../net/socket";
import { login, logout, refreshAccount, type Account } from "../net/auth";
import { useNetStore } from "../state/netStore";
import {
  IconAlert,
  IconChevron,
  IconEye,
  IconMap,
  IconServer,
  IconSigil,
  IconSwords,
  OccultMandala,
} from "./icons";

/** Onde a senha de mestre fica guardada neste navegador (para não digitar sempre). */
const GMKEY_STORAGE = "helio.gmkey";

/**
 * Tela de entrada — Grimório / Portal de Convocação inspirado em Ordem Paranormal.
 *
 * Jogador entra com o código da missão e recebe um token próprio.
 * Mestre só entra com a chave da Ordem (`GM_KEY`).
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Conta (opcional) ───────────────────────────────────────────────────────
  // Entrar é opcional de propósito: convidado digita o nome e joga. A conta
  // serve para o mestre (não precisa de senha se for o dono da campanha) e para
  // não redigitar o nome a cada sessão.
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    // O cookie pode já estar no navegador de uma visita anterior.
    let alive = true;
    void refreshAccount().then((a) => {
      if (alive && a) setAccount(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    const result = await login(user.trim(), password);
    setAuthBusy(false);
    if (result.ok && result.account) {
      setAccount(result.account);
      setPassword(""); // a senha não fica na tela depois de usada
    } else {
      setAuthError(result.error ?? "Não foi possível entrar.");
    }
  };

  const signOut = async () => {
    await logout();
    setAccount(null);
    setUser("");
    setPassword("");
    setAuthError("");
  };

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
      {/* Mandala Esotérica Giratória no Fundo */}
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

      <form
        onSubmit={submit}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 410,
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
        {/* Cantos Ornamentais Dourados */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          style={{ position: "absolute", top: 7, left: 7, color: "#f59e0b", opacity: 0.7 }}
        >
          <path d="M1 15V3a2 2 0 0 1 2-2h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <circle cx="4" cy="4" r="1.5" fill="currentColor" />
        </svg>
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          style={{
            position: "absolute",
            top: 7,
            right: 7,
            color: "#f59e0b",
            opacity: 0.7,
            transform: "scaleX(-1)",
          }}
        >
          <path d="M1 15V3a2 2 0 0 1 2-2h12" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <circle cx="4" cy="4" r="1.5" fill="currentColor" />
        </svg>

        {/* Cabeçalho Ritualístico */}
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
              marginBottom: 8,
            }}
          >
            Membrana · Mesa Paranormal
          </div>

          <div style={{ fontSize: 12, color: "#9d8ec4", lineHeight: 1.45 }}>
            Quem convoca a sessão controla a realidade; os agentes ingressam pelo selo da sala.
          </div>
        </div>

        {/* Conta — opcional, mas é o que dispensa redigitar o nome */}
        <div
          style={{
            border: "1px solid rgba(139, 92, 246, 0.28)",
            background: "rgba(12, 8, 24, 0.55)",
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          {account ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <IconEye size={16} style={{ color: "#fbbf24", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#fde68a", fontWeight: 600 }}>
                  {account.name}
                </div>
                <div style={{ fontSize: 10, color: "#7e6ea8" }}>
                  Conta reconhecida · nome e papel vêm daqui
                </div>
              </div>
              <button
                type="button"
                className="occult-btn"
                style={{ padding: "4px 10px", fontSize: 11 }}
                onClick={() => void signOut()}
              >
                Sair
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <IconEye size={14} style={{ color: "#a78bfa" }} />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#d8cef0",
                  }}
                >
                  Entrar com conta
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="occult-input"
                  style={{ padding: "8px 10px", fontSize: 12 }}
                  value={user}
                  placeholder="Usuário"
                  maxLength={24}
                  autoComplete="username"
                  onChange={(e) => setUser(e.target.value)}
                />
                <input
                  className="occult-input"
                  style={{ padding: "8px 10px", fontSize: 12 }}
                  type="password"
                  value={password}
                  placeholder="Senha"
                  maxLength={128}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter no campo de senha entra na conta, e não envia o
                    // formulário inteiro (que tentaria conectar na mesa).
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void signIn();
                    }
                  }}
                />
                <button
                  type="button"
                  className="occult-btn"
                  style={{ padding: "8px 14px", fontSize: 12, flexShrink: 0 }}
                  disabled={authBusy || user.trim() === "" || password === ""}
                  onClick={() => void signIn()}
                >
                  {authBusy ? "..." : "Entrar"}
                </button>
              </div>
              {authError ? (
                <div style={{ fontSize: 11, color: "#fca5a5" }}>{authError}</div>
              ) : (
                <div style={{ fontSize: 10, color: "#7e6ea8", lineHeight: 1.4 }}>
                  Opcional — agente entra só com o nome. Senha temporária: ainda
                  não existe recuperação de senha nem troca de senha.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nome do Agente / Narrador */}
        <div>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#d8cef0",
              marginBottom: 5,
              display: "block",
            }}
          >
            Identificação na Ordem
          </label>
          <input
            className="occult-input"
            style={{ padding: "10px 12px", fontSize: 13 }}
            value={name}
            placeholder="Ex.: Arthur Cervero, Dante, Kaiser..."
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
          />
          {account && (
            <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 4 }}>
              Logado como <span style={{ color: "#fde68a" }}>{account.name}</span> —
              o servidor usa o nome da conta e ignora este campo.
            </div>
          )}
        </div>

        {/* Código da Sala */}
        <div>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#d8cef0",
              marginBottom: 5,
              display: "block",
            }}
          >
            Selo da Missão (Código da Sala)
          </label>
          <input
            className="occult-input"
            style={{
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              letterSpacing: "0.14em",
              color: "#fde68a",
            }}
            value={code}
            maxLength={24}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 4 }}>
            Compartilhe este selo com os investigadores para sincronizar o mapa.
          </div>
        </div>

        {/* Papel: Mestre vs Jogador */}
        <div>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#d8cef0",
              marginBottom: 6,
              display: "block",
            }}
          >
            Papel no Ritual
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              onClick={() => setRole("gm")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "12px 10px",
                borderRadius: 10,
                cursor: "pointer",
                border:
                  role === "gm"
                    ? "1px solid #f59e0b"
                    : "1px solid rgba(139, 92, 246, 0.25)",
                background:
                  role === "gm"
                    ? "linear-gradient(145deg, rgba(109, 40, 217, 0.45) 0%, rgba(180, 83, 9, 0.25) 100%)"
                    : "rgba(10, 6, 20, 0.75)",
                color: role === "gm" ? "#fef3c7" : "#9d8ec4",
                boxShadow:
                  role === "gm"
                    ? "0 0 20px rgba(168, 85, 247, 0.3), inset 0 0 12px rgba(245, 158, 11, 0.15)"
                    : "none",
                transition: "all 0.18s ease",
              }}
            >
              <IconEye size={20} style={{ color: role === "gm" ? "#fbbf24" : "#8b7cb5" }} />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                }}
              >
                MESTRE
              </span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>Onisciente · Narra</span>
            </button>

            <button
              type="button"
              onClick={() => setRole("player")}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "12px 10px",
                borderRadius: 10,
                cursor: "pointer",
                border:
                  role === "player"
                    ? "1px solid #a855f7"
                    : "1px solid rgba(139, 92, 246, 0.25)",
                background:
                  role === "player"
                    ? "linear-gradient(145deg, rgba(126, 34, 206, 0.45) 0%, rgba(59, 7, 100, 0.5) 100%)"
                    : "rgba(10, 6, 20, 0.75)",
                color: role === "player" ? "#f3e8ff" : "#9d8ec4",
                boxShadow:
                  role === "player"
                    ? "0 0 20px rgba(168, 85, 247, 0.35), inset 0 0 12px rgba(168, 85, 247, 0.2)"
                    : "none",
                transition: "all 0.18s ease",
              }}
            >
              <IconSwords size={20} style={{ color: role === "player" ? "#c084fc" : "#8b7cb5" }} />
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                }}
              >
                AGENTE
              </span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>Jogador · Token</span>
            </button>
          </div>
        </div>

        {/* Senha de Mestre */}
        {role === "gm" && (
          <div>
            <label
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#fde68a",
                marginBottom: 5,
                display: "block",
              }}
            >
              Chave Veríssimo (Senha de Mestre)
            </label>
            <input
              className="occult-input"
              style={{ padding: "10px 12px", fontSize: 13 }}
              type="password"
              value={gmKey}
              maxLength={64}
              placeholder="Definida em GM_KEY no servidor"
              onChange={(e) => setGmKey(e.target.value)}
            />
            <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 4 }}>
              {account
                ? `Logado como ${account.name}. Só é preciso se essa conta não for a dona da campanha.`
                : "Salva neste navegador. Agentes não precisam de chave."}
            </div>
          </div>
        )}

        {/* Configuração Avançada de Servidor */}
        <button
          type="button"
          className="occult-btn"
          style={{
            width: "100%",
            justifyContent: "space-between",
            background: "rgba(12, 8, 24, 0.6)",
            color: "#9d8ec4",
          }}
          onClick={() => setShowAdvanced((p) => !p)}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <IconServer size={14} /> Endereço do Servidor
          </span>
          <IconChevron size={14} dir={showAdvanced ? "up" : "down"} />
        </button>

        {showAdvanced && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(8, 5, 16, 0.75)",
              border: "1px solid rgba(139, 92, 246, 0.2)",
              borderRadius: 8,
            }}
          >
            <input
              className="occult-input"
              value={url}
              placeholder="Vazio = conectar nesta mesma página"
              onChange={(e) => {
                setUrl(e.target.value);
                // O mesmo endereço vale para as rotas de auth (ADR #16): quem
                // digita aqui espera entrar NAQUELE servidor, e não em outro.
                useNetStore.getState().setServerUrl(e.target.value);
              }}
            />
            <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 5 }}>
              Deixe em branco para usar o servidor padrão desta URL.
            </div>
          </div>
        )}

        {/* Avisos de Erro ou Conexão */}
        {notice && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#fecaca",
              background: "rgba(69, 10, 10, 0.85)",
              border: "1px solid rgba(220, 38, 38, 0.6)",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <IconAlert size={16} style={{ color: "#f87171", flexShrink: 0 }} />
            <span>{notice}</span>
          </div>
        )}

        {connecting && (
          <div
            style={{
              fontSize: 12,
              color: "#fde68a",
              textAlign: "center",
              letterSpacing: "0.08em",
            }}
          >
            Sintonizando a Membrana…
          </div>
        )}

        {/* Botão Principal */}
        <button
          type="submit"
          disabled={connecting}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 9,
            border: "1px solid #f59e0b",
            background:
              "linear-gradient(135deg, #7e22ce 0%, #581c87 55%, #9a3412 100%)",
            color: "#ffffff",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: connecting ? "wait" : "pointer",
            boxShadow:
              "0 6px 24px rgba(147, 51, 234, 0.45), inset 0 1px 0 rgba(254, 243, 199, 0.35)",
            transition: "all 0.2s ease",
          }}
        >
          {connecting ? "Atravessando…" : "Ingressar na Sessão"}
        </button>

        {/* Modo Solo / Preparação */}
        <button
          type="button"
          className="occult-btn"
          style={{
            width: "100%",
            padding: "9px 12px",
            background: "transparent",
            borderColor: "rgba(139, 92, 246, 0.25)",
            color: "#b4a5d9",
          }}
          onClick={onLocal}
        >
          <IconMap size={15} />
          Preparar o Mapa Sozinho (Modo Local)
        </button>
      </form>
    </div>
  );
}
