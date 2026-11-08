import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate } from "react-router-dom";
import {
  getAdminSettings,
  listAllAccounts,
  resetPassword,
  saveAdminSettings,
  setAccountAdmin,
  type AdminAccount,
  type AdminSettings,
} from "../net/auth";
import { useSession } from "../state/sessionStore";
import { IconLock, IconSigil, IconUnlock } from "../components/icons";
import Shell from "./Shell";
import { resetPasswordSchema, type ResetPasswordInput } from "../lib/validation";

const FIELD_LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#d8cef0",
  marginBottom: 5,
  display: "block",
};

/** `24/10, 21:03` — curto o bastante para caber na linha da conta. */
function visto(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Painel do administrador (ADRs #23, #24 e #25).
 *
 * Existe por um motivo só: **não há recuperação de senha**. Sem esta tela, o
 * jeito de devolver a conta a alguém seria mexer no banco na mão. Por isso ela
 * é pequena de propósito — lista contas, troca senha, delega a administração e
 * mexe nas duas configurações que antes exigiam `.env` + restart: o cadastro e a
 * sala da casa.
 *
 * Quem vê esta página é decidido pelo servidor (o nome da conta ou a flag de
 * admin delegado), e não por este arquivo: a guarda daqui é conveniência, cada
 * rota `/api/admin/*` confere a sessão de novo.
 */
export default function Admin() {
  const ready = useSession((s) => s.ready);
  const account = useSession((s) => s.account);
  const load = useSession((s) => s.load);

  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [adminName, setAdminName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filtro, setFiltro] = useState("");

  /** Configuração viva do servidor (ADR #25). `null` = ainda não chegou. */
  const [servidor, setServidor] = useState<AdminSettings | null>(null);
  const [salaDraft, setSalaDraft] = useState("");
  const [servidorBusy, setServidorBusy] = useState(false);
  const [servidorErro, setServidorErro] = useState("");

  const [target, setTarget] = useState<string | null>(null);
  const [busyAdmin, setBusyAdmin] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feito, setFeito] = useState("");

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  useEffect(() => {
    // Só o administrador precisa da lista — e só ele consegue pedi-la.
    if (!account?.admin) return;
    let alive = true;
    void Promise.all([listAllAccounts(), getAdminSettings()]).then(([lista, cfg]) => {
      if (!alive) return;
      setLoading(false);
      if (lista.ok) {
        setAccounts(lista.accounts ?? []);
        setAdminName(lista.admin ?? "");
      } else {
        setLoadError(lista.error ?? "Não deu para listar as contas.");
      }
      if (cfg.ok && cfg.settings) {
        setServidor(cfg.settings);
        setSalaDraft(cfg.settings.defaultRoom);
      } else {
        setServidorErro(cfg.error ?? "Não deu para ler a configuração do servidor.");
      }
    });
    return () => {
      alive = false;
    };
  }, [account]);

  const raiz = adminName.trim().toLowerCase();
  const ehRaiz = (nome: string) => raiz !== "" && nome.trim().toLowerCase() === raiz;

  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return q ? accounts.filter((a) => a.name.toLowerCase().includes(q)) : accounts;
  }, [accounts, filtro]);

  const delegados = accounts.filter((a) => a.isAdmin && !ehRaiz(a.name)).length;

  if (!ready) {
    return (
      <Shell title="Painel do Administrador" subtitle="Consultando a Membrana…">
        <div style={{ fontSize: 12, color: "#fde68a", textAlign: "center" }}>
          Sintonizando…
        </div>
      </Shell>
    );
  }
  if (!account) return <Navigate to="/entrar" replace />;
  if (!account.admin) return <Navigate to="/mesa" replace />;

  const escolhida = accounts.find((a) => a.name === target) ?? null;

  const escolher = (name: string) => {
    setTarget(name);
    senhaForm.reset({ password: "", password2: "" });
    setError("");
    setFeito("");
  };

  // ── Formulário de trocar senha ─────────────────────────────────────────────
  const senhaForm = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", password2: "" },
  });

  const onTrocarSenha = async (data: ResetPasswordInput) => {
    if (!target) return;
    const result = await resetPassword(target, data.password);
    if (!result.ok) {
      setError(result.error ?? "Não deu para trocar a senha.");
      return;
    }
    setFeito(`Senha de "${target}" trocada.`);
    senhaForm.reset({ password: "", password2: "" });
  };

  const alternarAdmin = async (a: AdminAccount) => {
    if (busyAdmin) return;
    const dar = !a.isAdmin;
    setBusyAdmin(a.name);
    setError("");
    setFeito("");
    const result = await setAccountAdmin(a.name, dar);
    setBusyAdmin(null);
    if (!result.ok) {
      setError(result.error ?? "Não deu para mudar a administração.");
      return;
    }
    setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, isAdmin: dar } : x)));
    setFeito(
      dar
        ? `"${a.name}" agora é administrador(a). A pessoa vê o painel ao recarregar a página.`
        : `"${a.name}" deixou de ser administrador(a).`,
    );
  };

  /** A configuração que o servidor devolveu é a fonte da verdade. */
  const aplicarServidor = (s: AdminSettings) => {
    setServidor(s);
    setSalaDraft(s.defaultRoom);
  };

  const alternarCadastro = async () => {
    if (!servidor || servidorBusy) return;
    const abrir = servidor.registration === "closed";
    setServidorBusy(true);
    setServidorErro("");
    setError("");
    setFeito("");
    const result = await saveAdminSettings({ registration: abrir });
    setServidorBusy(false);
    if (!result.ok || !result.settings) {
      setServidorErro(result.error ?? "Não deu para mudar o cadastro.");
      return;
    }
    aplicarServidor(result.settings);
    // A tela de entrada lê `signup` do store: sem isto, o botão "criar conta"
    // ficaria com a resposta velha até um F5.
    useSession.setState({ signup: abrir });
    setFeito(
      abrir
        ? "Cadastro aberto. Enquanto estiver assim, qualquer pessoa com a URL cria conta."
        : "Cadastro fechado. Só entram contas que já existem.",
    );
  };

  const salvarSala = async () => {
    if (!servidor || servidorBusy) return;
    setServidorBusy(true);
    setServidorErro("");
    setError("");
    setFeito("");
    const result = await saveAdminSettings({ defaultRoom: salaDraft });
    setServidorBusy(false);
    if (!result.ok || !result.settings) {
      setServidorErro(result.error ?? "Não deu para salvar a sala da casa.");
      return;
    }
    aplicarServidor(result.settings);
    setFeito(
      result.settings.defaultRoom
        ? `Sala da casa: ${result.settings.defaultRoom}.`
        : "Sem sala da casa: o lobby só mostra as missões de cada pessoa.",
    );
  };

  return (
    <Shell
      title="Painel do Administrador"
      subtitle="Senha esquecida, administração delegada, cadastro e sala da casa. Só quem já é administrador vê esta página."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {/* Quem está olhando, e quantos administradores existem */}
        <div
          style={{
            border: "1px solid rgba(139, 92, 246, 0.28)",
            background: "rgba(12, 8, 24, 0.55)",
            borderRadius: 10,
            padding: "9px 12px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <IconLock size={15} style={{ color: "#fbbf24", flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#fde68a", fontWeight: 600 }}>
              {account.name}
            </div>
            <div style={{ fontSize: 10, color: "#7e6ea8" }}>
              Raiz: {adminName || "—"} · delegados: {delegados}
            </div>
          </div>
        </div>

        {error ? <div style={{ fontSize: 11, color: "#fca5a5" }}>{error}</div> : null}
        {feito ? <div style={{ fontSize: 11, color: "#86efac" }}>{feito}</div> : null}

        {/* Configuração viva do servidor (ADR #25) */}
        <div
          style={{
            border: "1px solid rgba(139, 92, 246, 0.22)",
            background: "rgba(8, 5, 16, 0.5)",
            borderRadius: 10,
            padding: "9px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: "#fde68a", fontWeight: 600 }}>
                Cadastro
              </div>
              <div
                style={{
                  fontSize: 10,
                  lineHeight: 1.4,
                  color: servidor?.registration === "open" ? "#f0abfc" : "#7e6ea8",
                }}
              >
                {servidor === null
                  ? "Lendo…"
                  : servidor.registration === "open"
                    ? "Aberto — qualquer pessoa com a URL cria conta."
                    : "Fechado — só entram contas que já existem."}
              </div>
            </div>
            <button
              type="button"
              className="occult-btn"
              disabled={!servidor || servidorBusy}
              onClick={() => void alternarCadastro()}
              style={{ padding: "6px 10px", fontSize: 11, flexShrink: 0 }}
            >
              {servidorBusy ? "…" : servidor?.registration === "open" ? "Fechar" : "Abrir"}
            </button>
          </div>

          <div style={{ borderTop: "1px solid rgba(139, 92, 246, 0.18)", paddingTop: 8 }}>
            <label style={{ ...FIELD_LABEL, marginBottom: 4 }} htmlFor="sala-casa">
              Sala da casa
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                id="sala-casa"
                className="occult-input"
                value={salaDraft}
                maxLength={32}
                placeholder="Nenhuma (vazio)"
                autoComplete="off"
                onChange={(e) => setSalaDraft(e.target.value)}
                style={{
                  padding: "7px 10px",
                  fontSize: 12,
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "var(--font-mono)",
                }}
              />
              <button
                type="button"
                className="occult-btn"
                disabled={
                  !servidor ||
                  servidorBusy ||
                  salaDraft.trim().toUpperCase() === (servidor?.defaultRoom ?? "")
                }
                onClick={() => void salvarSala()}
                style={{ padding: "7px 11px", fontSize: 11, flexShrink: 0 }}
              >
                Salvar
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#7e6ea8", marginTop: 5, lineHeight: 1.45 }}>
              O selo que o lobby oferece a quem ainda não é membro. É só um atalho — as
              missões continuam sendo criadas em <em>Missões</em>, quantas quiser.
            </div>
          </div>

          {servidorErro ? (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>{servidorErro}</div>
          ) : null}
        </div>

        {/* Contas */}
        <div>
          <label style={FIELD_LABEL} htmlFor="filtro-contas">
            Contas ({accounts.length})
          </label>
          <input
            id="filtro-contas"
            className="occult-input"
            value={filtro}
            placeholder="Filtrar por nome…"
            autoComplete="off"
            onChange={(e) => setFiltro(e.target.value)}
            style={{ padding: "7px 10px", fontSize: 12, marginBottom: 6 }}
          />

          {loading && (
            <div style={{ fontSize: 11, color: "#9d8ec4" }}>Carregando as contas…</div>
          )}
          {loadError && <div style={{ fontSize: 11, color: "#fca5a5" }}>{loadError}</div>}
          {!loading && !loadError && lista.length === 0 && (
            <div style={{ fontSize: 11, color: "#9d8ec4" }}>Nenhuma conta com esse nome.</div>
          )}

          {!loading && lista.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                maxHeight: 230,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              {lista.map((a) => {
                const atual = a.name === target;
                const root = ehRaiz(a.name);
                const admin = a.isAdmin || root;
                return (
                  <div key={a.id} style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => escolher(a.name)}
                      title="Escolher esta conta para trocar a senha"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: "left",
                        cursor: "pointer",
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: atual
                          ? "1px solid rgba(245, 158, 11, 0.6)"
                          : "1px solid rgba(139, 92, 246, 0.18)",
                        background: atual
                          ? "rgba(245, 158, 11, 0.1)"
                          : "rgba(8, 5, 16, 0.6)",
                        color: "#f3effb",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          color: "#d8cef0",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {a.name}
                      </span>
                      {admin && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 9,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "#fbbf24",
                            border: "1px solid rgba(245, 158, 11, 0.45)",
                            borderRadius: 4,
                            padding: "0 4px",
                          }}
                        >
                          {root ? "raiz" : "admin"}
                        </span>
                      )}
                      {a.name === account.name && (
                        <span
                          style={{
                            flexShrink: 0,
                            fontSize: 9,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "#9d8ec4",
                            border: "1px solid rgba(139, 92, 246, 0.35)",
                            borderRadius: 4,
                            padding: "0 4px",
                          }}
                        >
                          você
                        </span>
                      )}
                      <span
                        style={{
                          marginLeft: "auto",
                          flexShrink: 0,
                          fontSize: 9.5,
                          lineHeight: 1.35,
                          color: "#7e6ea8",
                          textAlign: "right",
                        }}
                      >
                        {a.owned} missões · {a.joined} mesas
                        <br />
                        {a.lastLoginAt ? `visto ${visto(a.lastLoginAt)}` : "nunca entrou"}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void alternarAdmin(a)}
                      disabled={root || busyAdmin !== null}
                      title={
                        root
                          ? `A conta raiz (${adminName}) é sempre administradora.`
                          : admin
                            ? "Tirar a administração"
                            : "Dar a administração"
                      }
                      style={{
                        flexShrink: 0,
                        width: 30,
                        borderRadius: 6,
                        border: admin
                          ? "1px solid rgba(245, 158, 11, 0.45)"
                          : "1px solid rgba(139, 92, 246, 0.25)",
                        background: admin
                          ? "rgba(245, 158, 11, 0.12)"
                          : "rgba(8, 5, 16, 0.6)",
                        color: root ? "#5d4e82" : admin ? "#fbbf24" : "#9d8ec4",
                        cursor: root || busyAdmin !== null ? "default" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {busyAdmin === a.name ? (
                        "…"
                      ) : admin ? (
                        <IconLock size={12} />
                      ) : (
                        <IconUnlock size={12} />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Senha da conta escolhida */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void senhaForm.handleSubmit(onTrocarSenha)(e);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label style={FIELD_LABEL} htmlFor="nova-senha">
            {escolhida ? `Nova senha de ${escolhida.name}` : "Escolha uma conta acima"}
          </label>
          <input
            id="nova-senha"
            className="occult-input"
            type="password"
            maxLength={200}
            placeholder="Senha nova"
            autoComplete="new-password"
            disabled={!escolhida}
            {...senhaForm.register("password")}
            style={{ padding: "9px 11px", fontSize: 12 }}
          />
          {senhaForm.formState.errors.password && (
            <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 2 }}>
              {senhaForm.formState.errors.password?.message}
            </div>
          )}
          <input
            className="occult-input"
            type="password"
            maxLength={200}
            placeholder="Repita a senha"
            autoComplete="new-password"
            disabled={!escolhida}
            {...senhaForm.register("password2")}
            style={{ padding: "9px 11px", fontSize: 12 }}
          />
          {senhaForm.formState.errors.password2 && (
            <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 2 }}>
              {senhaForm.formState.errors.password2?.message}
            </div>
          )}
          {senhaForm.formState.errors.root && (
            <div style={{ fontSize: 10, color: "#fca5a5", marginTop: 2 }}>
              {senhaForm.formState.errors.root?.message}
            </div>
          )}

          <button
            type="submit"
            className="occult-btn"
            disabled={
              !escolhida || !!busyAdmin || senhaForm.formState.isSubmitting
            }
            style={{ width: "100%", padding: "9px 12px" }}
          >
            <IconSigil size={13} />
            {senhaForm.formState.isSubmitting ? "Gravando…" : "Trocar senha"}
          </button>
        </form>

        <div
          style={{
            fontSize: 10,
            color: "#7e6ea8",
            lineHeight: 1.5,
            borderTop: "1px solid rgba(139, 92, 246, 0.18)",
            paddingTop: 9,
          }}
        >
          A senha nova vale no próximo login. Quem já está conectado continua — o cookie é
          assinado e não consulta o banco. Para derrubar todo mundo, troque{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>SESSION_SECRET</span> e reinicie.
        </div>

        <Link
          to="/mesa"
          className="occult-btn"
          style={{ textDecoration: "none", width: "100%", padding: "9px 12px" }}
        >
          ← Voltar para as missões
        </Link>
      </div>
    </Shell>
  );
}
