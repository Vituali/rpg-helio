import { useEffect, useState } from "react";
import type { Role } from "@helio/shared";
import { connect } from "../net/socket";
import {
  createAccount,
  createCampaign,
  deleteCampaign,
  listCampaigns,
  loadSession,
  login,
  logout,
  type Account,
  type Campaign,
} from "../net/auth";
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

/** Último selo usado neste navegador: convidado não redigita o selo toda vez. */
const SELO_STORAGE = "helio.selo";

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
  const [code, setCode] = useState(() => localStorage.getItem(SELO_STORAGE) ?? "HELIO");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("gm");
  const [gmKey, setGmKey] = useState(() => localStorage.getItem(GMKEY_STORAGE) ?? "");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Missões da conta (ADR #18) ─────────────────────────────────────────────
  // Criar e apagar exigem conta; escolher uma só preenche o selo. Perder o selo
  // não pode ser perder a mesa, por isso a lista fica aqui.
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [newName, setNewName] = useState("");
  const [missaoBusy, setMissaoBusy] = useState(false);
  const [missaoError, setMissaoError] = useState("");
  /** Selo recém-criado, para destacar o que o mestre precisa ditar. */
  const [seloNovo, setSeloNovo] = useState("");

  // ── Conta (opcional) ───────────────────────────────────────────────────────
  // Entrar é opcional de propósito: convidado digita o nome e joga. A conta
  // serve para não redigitar o nome a cada sessão e para o papel de mestre vir
  // do vínculo com a missão (ADR #19).
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  /** Cadastro usa o mesmo cartão do login, em dois modos (ADR #19). */
  const [authMode, setAuthMode] = useState<"entrar" | "criar">("entrar");
  const [password2, setPassword2] = useState("");
  /** O servidor aceita cadastro? Vem junto de `/api/auth/me` (ADR #19). */
  const [signupOpen, setSignupOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    // O cookie pode já estar no navegador de uma visita anterior.
    let alive = true;
    void loadSession().then((s) => {
      if (!alive) return;
      if (s.account) setAccount(s.account);
      setSignupOpen(s.signup);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!account) {
      setCampaigns([]);
      return;
    }
    let alive = true;
    void listCampaigns().then((list) => {
      if (alive) setCampaigns(list);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  const reloadCampaigns = async () => setCampaigns(await listCampaigns());

  /**
   * A missão que está no campo do selo. Serve para avisar quando esta conta já é
   * mestra dela — o papel vem do vínculo (ADR #19), e quem escolhe "AGENTE" por
   * engano não mexe no mapa e não entende por quê.
   */
  const missaoDoCampo = campaigns.find((c) => c.code === code.trim().toUpperCase());
  const souMestreAqui = account !== null && missaoDoCampo?.role === "gm";

  const criarMissao = async () => {
    if (missaoBusy) return;
    setMissaoBusy(true);
    setMissaoError("");
    const result = await createCampaign(newName.trim());
    setMissaoBusy(false);
    if (result.ok && result.campaign) {
      setSeloNovo(result.campaign.code);
      setCode(result.campaign.code); // já joga o selo no campo de entrada
      setNewName("");
      await reloadCampaigns();
    } else {
      setMissaoError(result.error ?? "Não foi possível criar a missão.");
    }
  };

  const apagarMissao = async (c: Campaign) => {
    // Apagar leva a cena junto: a confirmação diz isso com todas as letras.
    const ok = window.confirm(
      `Apagar a missão "${c.name}" (${c.code})?\n\nO mapa, as paredes e o fog dela vão junto.`,
    );
    if (!ok) return;
    setMissaoError("");
    const result = await deleteCampaign(c.code);
    if (!result.ok) setMissaoError(result.error ?? "Não foi possível apagar.");
    // Recarrega SEMPRE, deu certo ou não: se falhou, a linha provavelmente já
    // não existia (alguém apagou em outro lugar) e insistir nela só rende mais
    // 404 — e a lista fica velha na tela, que foi como isto apareceu.
    if (seloNovo === c.code) setSeloNovo("");
    await reloadCampaigns();
  };

  /** Servidor aceitou: a conta entra e as senhas saem da tela. */
  const aceitarConta = (a: Account) => {
    setAccount(a);
    setPassword("");
    setPassword2("");
    setAuthError("");
    setAuthMode("entrar");
  };

  const signIn = async () => {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    const result = await login(user.trim(), password);
    setAuthBusy(false);
    if (result.ok && result.account) aceitarConta(result.account);
    else setAuthError(result.error ?? "Não foi possível entrar.");
  };

  /*
   * Criar conta (ADR #19). A conferência das duas senhas é do cliente, e existe
   * por um motivo concreto: **não há recuperação de senha** — quem erra digita a
   * senha errada para sempre. O servidor nem vê a segunda senha.
   */
  const criarConta = async () => {
    if (authBusy) return;
    if (password !== password2) {
      setAuthError("As duas senhas não são iguais.");
      return;
    }
    setAuthBusy(true);
    setAuthError("");
    const result = await createAccount(user.trim(), password);
    setAuthBusy(false);
    if (result.ok && result.account) aceitarConta(result.account);
    else setAuthError(result.error ?? "Não foi possível criar a conta.");
  };

  const signOut = async () => {
    await logout();
    setAccount(null);
    setUser("");
    setPassword("");
    setPassword2("");
    setAuthError("");
    setAuthMode("entrar");
  };

  const connecting = status === "connecting";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (role === "gm") localStorage.setItem(GMKEY_STORAGE, gmKey);
    // Guardar o selo: convidado não redigita a cada visita (ADR #18).
    localStorage.setItem(SELO_STORAGE, code.trim());
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
                  Conta reconhecida · o papel vem do vínculo com a missão
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
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <IconEye size={14} style={{ color: "#a78bfa", flexShrink: 0 }} />
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "#d8cef0",
                  }}
                >
                  {authMode === "criar" ? "Criar conta" : "Entrar com conta"}
                </span>
                {/* Sem cadastro aberto no servidor, este botão não existe: o
                    lobby não oferece o que o servidor vai recusar (ADR #19). */}
                {signupOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode(authMode === "criar" ? "entrar" : "criar");
                      setAuthError("");
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "#a78bfa",
                      fontSize: 11,
                      textDecoration: "underline",
                      cursor: "pointer",
                    }}
                  >
                    {authMode === "criar" ? "Já tenho conta" : "Criar conta"}
                  </button>
                )}
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
                  onKeyDown={(e) => {
                    // Enter aqui entra na conta, e não envia o formulário
                    // inteiro (que tentaria conectar na mesa).
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void (authMode === "criar" ? criarConta() : signIn());
                    }
                  }}
                />
                <input
                  className="occult-input"
                  style={{ padding: "8px 10px", fontSize: 12 }}
                  type="password"
                  value={password}
                  placeholder="Senha"
                  maxLength={200}
                  autoComplete={authMode === "criar" ? "new-password" : "current-password"}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void (authMode === "criar" ? criarConta() : signIn());
                    }
                  }}
                />
              </div>

              {authMode === "criar" && (
                <>
                  <input
                    className="occult-input"
                    style={{ padding: "8px 10px", fontSize: 12 }}
                    type="password"
                    value={password2}
                    placeholder="Repita a senha"
                    maxLength={200}
                    autoComplete="new-password"
                    onChange={(e) => setPassword2(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void criarConta();
                      }
                    }}
                  />
                  {password !== "" && password2 !== "" && password !== password2 && (
                    <div style={{ fontSize: 11, color: "#fca5a5" }}>
                      As duas senhas não são iguais.
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                className="occult-btn"
                style={{ padding: "8px 14px", fontSize: 12 }}
                disabled={
                  authBusy ||
                  user.trim() === "" ||
                  password === "" ||
                  (authMode === "criar" && password2 === "")
                }
                onClick={() => void (authMode === "criar" ? criarConta() : signIn())}
              >
                {authBusy ? "..." : authMode === "criar" ? "Criar conta e entrar" : "Entrar"}
              </button>

              {authError ? (
                <div style={{ fontSize: 11, color: "#fca5a5" }}>{authError}</div>
              ) : authMode === "criar" ? (
                <div style={{ fontSize: 10, color: "#7e6ea8", lineHeight: 1.4 }}>
                  Entra já logado. <strong>Não há recuperação de senha</strong> — o
                  mestre não vê nem troca a sua senha, então anote.
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "#7e6ea8", lineHeight: 1.4 }}>
                  Opcional — agente entra só com o nome. A conta serve para não
                  redigitar o nome e para o papel de mestre vir do vínculo com a
                  missão.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Missões da conta — criar, escolher e apagar (ADR #18) */}
        {account && (
          <div
            style={{
              border: "1px solid rgba(245, 158, 11, 0.3)",
              background: "rgba(12, 8, 24, 0.55)",
              borderRadius: 10,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <IconSigil size={14} style={{ color: "#fbbf24" }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#d8cef0",
                }}
              >
                Missões de {account.name}
              </span>
            </div>

            {campaigns.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 132,
                  overflowY: "auto",
                }}
              >
                {campaigns.map((c) => {
                  const atual = c.code === code.trim().toUpperCase();
                  return (
                    <div
                      key={c.code}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 7px",
                        borderRadius: 6,
                        border: atual
                          ? "1px solid rgba(245, 158, 11, 0.6)"
                          : "1px solid rgba(139, 92, 246, 0.18)",
                        background: atual ? "rgba(245, 158, 11, 0.1)" : "rgba(8, 5, 16, 0.6)",
                      }}
                    >
                      <button
                        type="button"
                        title="Usar este selo"
                        onClick={() => {
                          setCode(c.code);
                          setSeloNovo("");
                        }}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              color: "#d8cef0",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.name}
                          </span>
                          {/* O papel vem do vínculo (ADR #19): a mesma lista
                              serve ao mestre e ao agente, e o rótulo diz quem é
                              quem nesta missão. */}
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 9,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              color: c.role === "gm" ? "#fbbf24" : "#a78bfa",
                              border: `1px solid ${
                                c.role === "gm"
                                  ? "rgba(245, 158, 11, 0.45)"
                                  : "rgba(167, 139, 250, 0.45)"
                              }`,
                              borderRadius: 4,
                              padding: "0 4px",
                            }}
                          >
                            {c.role === "gm" ? "mestre" : "agente"}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#fbbf24",
                            fontFamily: "monospace",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {c.code}
                        </div>
                      </button>
                      {/* Apagar é do dono, e só ele vê o botão. Não é o que
                          protege a missão: o servidor confere de novo e
                          responde 404 para quem não é dono (ADR #18). */}
                      {c.owner && (
                        <button
                          type="button"
                          title="Apagar missão"
                          onClick={() => void apagarMissao(c)}
                          style={{
                            flexShrink: 0,
                            background: "none",
                            border: "none",
                            color: "#a78bfa",
                            cursor: "pointer",
                            fontSize: 15,
                            lineHeight: 1,
                            padding: "2px 4px",
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="occult-input"
                style={{ padding: "7px 9px", fontSize: 12 }}
                value={newName}
                placeholder="Nome da nova missão"
                maxLength={40}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button
                type="button"
                className="occult-btn"
                style={{ padding: "7px 12px", fontSize: 12, flexShrink: 0 }}
                disabled={missaoBusy}
                onClick={() => void criarMissao()}
              >
                {missaoBusy ? "..." : "Criar"}
              </button>
            </div>

            {seloNovo && (
              <div style={{ fontSize: 11, color: "#fde68a", lineHeight: 1.5 }}>
                Selo da nova missão:{" "}
                <span style={{ fontFamily: "monospace", fontWeight: 700 }}>{seloNovo}</span>
                <br />
                <span style={{ color: "#7e6ea8" }}>
                  Dite para o grupo — é por ele que os agentes entram.
                </span>
              </div>
            )}

            {missaoError ? (
              <div style={{ fontSize: 11, color: "#fca5a5" }}>{missaoError}</div>
            ) : (
              campaigns.length === 0 && (
                <div style={{ fontSize: 10, color: "#7e6ea8", lineHeight: 1.4 }}>
                  Nenhuma missão ainda. Crie uma e o selo sai pronto para ditar.
                </div>
              )
            )}
          </div>
        )}

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

        {/* Selo da Missão */}
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
            Selo da Missão
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
            maxLength={32}
            placeholder="CORVO-AMBAR-VEU-74"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 4 }}>
            {account
              ? "O mestre cria a missão acima e dita o selo. Sem ele, o servidor não abre a mesa."
              : "Peça o selo ao mestre — é ele que abre a mesa. Fica guardado neste navegador."}
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
          {souMestreAqui && (
            <div style={{ fontSize: 11, color: "#fde68a", marginTop: 6, lineHeight: 1.4 }}>
              Esta conta é <strong>mestra</strong> em {missaoDoCampo?.name}. Escolha
              MESTRE para comandar o mapa — sem conta, só com a senha de mestre.
            </div>
          )}
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
                ? `Logado como ${account.name}. Só é preciso se esta conta não for mestra da missão.`
                : "Caminho antigo, para quem não tem conta: com conta, o papel de mestre vem do vínculo com a missão."}
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
