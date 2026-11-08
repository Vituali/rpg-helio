import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Navigate, Link, useNavigate } from "react-router-dom";
import {
  createCampaign,
  deleteCampaign,
  getSettings,
  listCampaigns,
  logout,
  renameCampaign,
  type Campaign,
} from "../net/auth";
import { connect } from "../net/socket";
import { useNetStore } from "../state/netStore";
import { useSession } from "../state/sessionStore";
import {
  IconChevron,
  IconEye,
  IconLock,
  IconSigil,
  IconSwords,
} from "../components/icons";
import Shell from "./Shell";
import { createCampaignSchema, type CreateCampaignInput } from "../lib/validation";

/** Último selo digitado neste navegador — o convite não se redigita toda vez. */
const SELO_STORAGE = "helio.selo";

/** Senha de mestre (escapatória legada): guardada só para não digitar sempre. */
const GMKEY_STORAGE = "helio.gmkey";

const FIELD_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#d8cef0",
  marginBottom: 5,
  display: "block",
};

/**
 * Página 2 — escolher a missão e entrar (ADR #20/#21).
 *
 * O papel **não** se escolhe: quem criou a missão é mestre dela, e quem foi
 * promovido também (ADR #22). A tela só mostra o que o servidor vai decidir.
 * A senha de mestre continua aqui, escondida, como escapatória.
 */
export default function Mesa() {
  const navigate = useNavigate();
  const ready = useSession((s) => s.ready);
  const account = useSession((s) => s.account);
  const load = useSession((s) => s.load);
  const clear = useSession((s) => s.clear);

  const status = useNetStore((s) => s.status);

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  // Sem selo fixo no cliente (ADR #25): vale o último usado neste navegador e,
  // se não houver, a missão mais recente — o servidor diz isso na lista.
  const [code, setCode] = useState(() => localStorage.getItem(SELO_STORAGE) ?? "");
  /** Sala da casa, definida no painel; vazio = nenhuma. */
  const [casa, setCasa] = useState("");
  const [gmKey, setGmKey] = useState(() => localStorage.getItem(GMKEY_STORAGE) ?? "");
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [missaoError, setMissaoError] = useState("");
  const [novoNomeDaMissao, setNovoNomeDaMissao] = useState("");
  const [renomeando, setRenomeando] = useState(false);
  /** Selo recém-criado, para destacar o que o mestre precisa ditar. */
  const [seloNovo, setSeloNovo] = useState("");

  // ── Formulário de criar missão ───────────────────────────────────────────
  const criarForm = useForm<CreateCampaignInput>({
    resolver: zodResolver(createCampaignSchema),
    defaultValues: { name: "" },
  });

  const onCriarMissao = async (data: CreateCampaignInput) => {
    const name = data.name?.trim() || undefined;
    const result = await createCampaign(name ?? "");
    if (result.ok && result.campaign) {
      setSeloNovo(result.campaign.code);
      setCode(result.campaign.code); // já deixa a missão nova escolhida
      criarForm.reset({ name: "" });
      await reloadCampaigns();
    } else {
      setMissaoError(result.error ?? "Não foi possível criar a missão.");
    }
  };

  const onRenomearMissao = async () => {
    if (!code.trim()) return;
    setRenomeando(true);
    const result = await renameCampaign(code, novoNomeDaMissao.trim());
    setRenomeando(false);
    if (result.ok) {
      await reloadCampaigns();
      setNovoNomeDaMissao("");
    } else {
      setMissaoError(result.error ?? "Não foi possível renomear a missão.");
    }
  };

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  useEffect(() => {
    // Sem conta não há lista (e a guarda abaixo já leva para /entrar).
    if (!account) return;
    let alive = true;
    void Promise.all([listCampaigns(), getSettings()]).then(([list, cfg]) => {
      if (!alive) return;
      setCampaigns(list);
      setCasa(cfg.defaultRoom);
      // Selo salvo vence; sem ele, a missão mais recente. O cliente não guarda
      // um código fixo — quem diz qual é a mesa é o servidor (ADR #25).
      setCode((atual) => (atual !== "" ? atual : (list[0]?.code ?? cfg.defaultRoom)));
    });
    return () => {
      alive = false;
    };
  }, [account]);

  // Entrou na sala: a mesa é a rota "/".
  useEffect(() => {
    if (status === "online") navigate("/", { replace: true });
  }, [status, navigate]);

  if (!ready) {
    return (
      <Shell step={2} title="Escolha da Missão" subtitle="Consultando a Membrana…">
        <div style={{ fontSize: 12, color: "#fde68a", textAlign: "center" }}>
          Sintonizando…
        </div>
      </Shell>
    );
  }
  if (!account) return <Navigate to="/entrar" replace />;

  const selo = code.trim().toUpperCase();
  const escolhida = campaigns.find((c) => c.code === selo);
  const chaveDigitada = gmKey.trim() !== "";
  const papel: "gm" | "player" | null =
    escolhida?.role === "gm" || chaveDigitada ? "gm" : escolhida ? "player" : null;
  const connecting = status === "connecting";

  const reloadCampaigns = async () => setCampaigns(await listCampaigns());

  const apagarMissao = async (c: Campaign) => {
    // Apagar leva a cena junto: a confirmação diz isso com todas as letras.
    const ok = window.confirm(
      `Apagar a missão "${c.name}" (${c.code})?\n\nO mapa, as paredes e o fog dela vão junto.`,
    );
    if (!ok) return;
    setMissaoError("");
    const result = await deleteCampaign(c.code);
    if (!result.ok) setMissaoError(result.error ?? "Não foi possível apagar.");
    // Recarrega SEMPRE: se falhou, a linha provavelmente já não existia (alguém
    // apagou em outro lugar) e insistir nela só rende mais 404.
    if (seloNovo === c.code) setSeloNovo("");
    await reloadCampaigns();
  };

  const sair = async () => {
    await logout();
    clear();
    navigate("/entrar", { replace: true });
  };

  const entrar = (e: FormEvent) => {
    e.preventDefault();
    if (selo === "" || connecting) return;
    localStorage.setItem(SELO_STORAGE, selo);
    if (chaveDigitada) localStorage.setItem(GMKEY_STORAGE, gmKey.trim());
    else localStorage.removeItem(GMKEY_STORAGE);
    connect({ code: selo, key: chaveDigitada ? gmKey.trim() : "" });
  };

  return (
    <Shell
      step={2}
      title="Escolha da Missão"
      subtitle="O selo é o convite. Quem criou a missão é mestre dela; quem entra, entra como agente."
    >
      <form
        onSubmit={entrar}
        style={{ display: "flex", flexDirection: "column", gap: 15 }}
      >
        {/* Conta */}
        <div
          style={{
            border: "1px solid rgba(139, 92, 246, 0.28)",
            background: "rgba(12, 8, 24, 0.55)",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <IconEye size={16} style={{ color: "#fbbf24", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#fde68a", fontWeight: 600 }}>
              {account.name}
            </div>
            <div style={{ fontSize: 10, color: "#7e6ea8" }}>
              Conta reconhecida · o papel vem do vínculo com a missão
            </div>
          </div>
          {/* O painel só aparece para a conta de administração (ADR #23). O
              servidor confere de novo — esconder o link é conveniência. */}
          {account.admin && (
            <Link
              to="/admin"
              className="occult-btn"
              title="Painel do administrador"
              style={{
                padding: "4px 10px",
                fontSize: 11,
                textDecoration: "none",
                flexShrink: 0,
              }}
            >
              <IconLock size={12} />
              Painel
            </Link>
          )}
          <button
            type="button"
            className="occult-btn"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => void sair()}
          >
            Sair
          </button>
        </div>

        {/* Missões da conta — criar, escolher e apagar (ADR #18) */}
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

          {campaigns.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 150,
                overflowY: "auto",
              }}
            >
              {campaigns.map((c) => {
                const atual = c.code === selo;
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
                      title="Escolher este selo"
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
                        {/* O papel vem do vínculo (ADR #19): a mesma lista serve
                            ao mestre e ao agente, e o rótulo diz quem é quem. */}
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
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {c.code}
                      </div>
                    </button>
                    {/* Apagar é do dono, e só ele vê o botão. O servidor
                        confere de novo e responde 404 para quem não é dono. */}
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
          ) : (
            <div style={{ fontSize: 11, color: "#7e6ea8" }}>
              Você ainda não tem missão. Crie a primeira abaixo.
            </div>
          )}

          {/* Sala da casa (ADR #25): o atalho que o painel define, para quem
              ainda não é membro. Nada de selo fixo no cliente — o código vem do
              servidor e pode mudar sem rebuild. */}
          {casa !== "" && !campaigns.some((c) => c.code === casa) && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(30, 20, 50, 0.45)",
                border: "1px dashed rgba(245, 158, 11, 0.35)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#d8cef0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Sala da casa</span>
                <span style={{ fontSize: 9, color: "#a855f7", textTransform: "uppercase" }}>
                  atalho
                </span>
              </div>
              <button
                type="button"
                className="occult-btn occult-btn--gold"
                title="Entrar na missão que o administrador marcou como a mesa do grupo"
                style={{
                  padding: "6px 10px",
                  fontSize: 11,
                  justifyContent: "flex-start",
                  width: "100%",
                  fontFamily: "var(--font-mono)",
                }}
                onClick={() => {
                  setCode(casa);
                  setSeloNovo("");
                }}
              >
                <IconSigil size={13} />
                <span>{casa}</span>
              </button>
            </div>
          )}

          {/* Criação de novas campanhas restrita ou opcional */}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void criarForm.handleSubmit(onCriarMissao)(e);
              }}
              style={{ display: "flex", gap: 6 }}
            >
              <input
                className="occult-input"
                style={{ padding: "7px 9px", fontSize: 12, flex: 1, minWidth: 0 }}
                placeholder="Criar nova missão (Mestres)"
                maxLength={40}
                {...criarForm.register("name")}
              />
              {criarForm.formState.errors.name && (
                <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 2 }}>
                  {criarForm.formState.errors.name?.message}
                </div>
              )}
              <button
                type="submit"
                className="occult-btn"
                disabled={criarForm.formState.isSubmitting}
                style={{ padding: "7px 12px", fontSize: 12, flexShrink: 0 }}
              >
                {criarForm.formState.isSubmitting ? "…" : "+ Criar"}
              </button>
            </form>
          </div>

          {/* Renomear missão (só o mestre da missão selecionada) */}
          {campaigns.some((c) => c.code === code && c.role === "gm") && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 8, borderTop: "1px dashed rgba(245, 158, 11, 0.25)" }}>
              <input
                className="occult-input"
                value={novoNomeDaMissao}
                onChange={(e) => setNovoNomeDaMissao(e.target.value)}
                placeholder="Novo nome da missão"
                maxLength={40}
                disabled={renomeando}
                style={{
                  padding: "7px 9px",
                  fontSize: 12,
                  flex: 1,
                  minWidth: 0,
                }}
              />
              <button
                type="button"
                onClick={onRenomearMissao}
                disabled={renomeando || !novoNomeDaMissao.trim()}
                className="occult-btn occult-btn--gold"
                style={{ padding: "7px 12px", fontSize: 12, flexShrink: 0 }}
              >
                {renomeando ? "…" : "Renomear"}
              </button>
            </div>
          )}

          {seloNovo && (
            <div style={{ fontSize: 11, color: "#fde68a", lineHeight: 1.5 }}>
              Selo da nova missão:{" "}
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{seloNovo}</span>
              <br />
              <span style={{ color: "#7e6ea8" }}>
                Dite para o grupo — é por ele que os agentes entram.
              </span>
            </div>
          )}

          {missaoError ? (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>{missaoError}</div>
          ) : null}
        </div>

        {/* Identificação na Ordem — quem entra. O nome é o da conta. */}
        <div>
          <label style={FIELD_LABEL}>Identificação na Ordem</label>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid rgba(139, 92, 246, 0.25)",
              background: "rgba(8, 5, 16, 0.6)",
            }}
          >
            <span
              style={{
                fontSize: 13,
                color: "#f3effb",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {account.name}
            </span>
            <span
              style={{
                marginLeft: "auto",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "2px 7px",
                borderRadius: 999,
                border: `1px solid ${
                  papel === "gm"
                    ? "#f59e0b"
                    : papel === "player"
                      ? "#a855f7"
                      : "rgba(139, 92, 246, 0.35)"
                }`,
                background:
                  papel === "gm"
                    ? "rgba(180, 83, 9, 0.25)"
                    : papel === "player"
                      ? "rgba(126, 34, 206, 0.25)"
                      : "transparent",
                color:
                  papel === "gm" ? "#fef3c7" : papel === "player" ? "#e9d5ff" : "#9d8ec4",
              }}
            >
              {papel === "gm" ? (
                <IconEye size={11} />
              ) : papel === "player" ? (
                <IconSwords size={11} />
              ) : null}
              {papel === "gm" ? "MESTRE" : papel === "player" ? "AGENTE" : "—"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 4 }}>
            {escolhida
              ? escolhida.role === "gm"
                ? "Esta conta é mestra desta missão: você entra comandando o mapa."
                : "Esta conta é agente nesta missão. O mestre pode promovê-la na mesa."
              : chaveDigitada
                ? "Com a senha de mestre, você entra como mestre nesta sessão."
                : "O nome vem da conta. Escolha uma missão para ver o seu papel."}
          </div>
        </div>

        {/* Selo da Missão */}
        <div>
          <label style={FIELD_LABEL} htmlFor="selo">
            Selo da Missão
          </label>
          <input
            id="selo"
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
            onChange={(e) => setCode(e.target.value)}
          />
          <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 4 }}>
            Recebeu um selo do mestre? Cole aqui. Fica guardado neste navegador.
          </div>
        </div>

        {/* Escapatória: senha de mestre (legado) */}
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
            <IconSigil size={14} /> Opções avançadas
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
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "#d8cef0",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={showKey}
                onChange={(e) => {
                  setShowKey(e.target.checked);
                  if (!e.target.checked) setGmKey("");
                }}
              />
              Entrar como mestre com a senha do servidor
            </label>

            {showKey && (
              <>
                <input
                  className="occult-input"
                  type="password"
                  value={gmKey}
                  maxLength={64}
                  placeholder="Chave Veríssimo (GM_KEY)"
                  onChange={(e) => setGmKey(e.target.value)}
                />
                <div style={{ fontSize: 11, color: "#7e6ea8", lineHeight: 1.4 }}>
                  Caminho antigo e sem vínculo. Ele vale para esta sessão e não
                  promove ninguém: quem manda na missão é o vínculo, e o mestre pode
                  dá-lo pelo painel da mesa.
                </div>
              </>
            )}
          </div>
        )}

        {/* Entrar */}
        <button
          type="submit"
          disabled={selo === "" || connecting}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 9,
            border: "1px solid #f59e0b",
            background: "linear-gradient(135deg, #7e22ce 0%, #581c87 55%, #9a3412 100%)",
            color: "#ffffff",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: selo === "" || connecting ? "wait" : "pointer",
            opacity: selo === "" ? 0.55 : 1,
            boxShadow:
              "0 6px 24px rgba(147, 51, 234, 0.45), inset 0 1px 0 rgba(254, 243, 199, 0.35)",
            transition: "all 0.2s ease",
          }}
        >
          {connecting ? "Atravessando…" : "Ingressar na Sessão"}
        </button>
      </form>
    </Shell>
  );
}
