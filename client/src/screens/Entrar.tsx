import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { createAccount, login } from "../net/auth";
import { useNetStore } from "../state/netStore";
import { useSession } from "../state/sessionStore";
import { IconChevron, IconMap, IconServer } from "../components/icons";
import Shell from "./Shell";
import {
  createAccountSchema,
  loginSchema,
  type CreateAccountInput,
  type LoginInput,
} from "../lib/validation";

const FIELD_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#d8cef0",
  marginBottom: 5,
  display: "block",
};

/**
 * Página 1 — a conta (ADR #20/#21).
 *
 * Validação com Zod + React Hook Form: as mesmas regras do servidor
 * (`nameProblem` / `passwordProblem` em `server/src/http.ts`) são declaradas
 * uma única vez em `client/src/lib/validation.ts` e reutilizadas aqui.
 */
export default function Entrar() {
  const navigate = useNavigate();
  const ready = useSession((s) => s.ready);
  const account = useSession((s) => s.account);
  const signup = useSession((s) => s.signup);
  const load = useSession((s) => s.load);
  const accept = useSession((s) => s.accept);

  const serverUrl = useNetStore((s) => s.serverUrl);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Formulário de entrar ───────────────────────────────────────────────────
  const loginForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { name: "", password: "" },
  });

  const onLogin = async (data: LoginInput) => {
    const result = await login(data.name.trim(), data.password);
    if (result.ok && result.account) {
      accept(result.account);
      navigate("/mesa", { replace: true });
      return;
    }
    loginForm.setError("root", {
      type: "server",
      message: result.error ?? "Não foi possível entrar.",
    });
  };

  // ── Formulário de criar conta ──────────────────────────────────────────────
  const createForm = useForm<CreateAccountInput>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: { name: "", password: "", password2: "" },
  });

  const onCreate = async (data: CreateAccountInput) => {
    const result = await createAccount(data.name.trim(), data.password);
    if (result.ok && result.account) {
      accept(result.account);
      navigate("/mesa", { replace: true });
      return;
    }
    createForm.setError("root", {
      type: "server",
      message: result.error ?? "Não foi possível criar a conta.",
    });
  };

  // O cookie pode já estar no navegador de uma visita anterior.
  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  // Já está logado? Não faz sentido pedir senha de novo.
  useEffect(() => {
    if (ready && account) navigate("/mesa", { replace: true });
  }, [ready, account, navigate]);

  const [mode, setMode] = useState<"entrar" | "criar">("entrar");

  return (
    <Shell
      step={1}
      title="Identificação na Ordem"
      subtitle="A Membrana exige um nome e uma senha. É a conta que diz quem você é na mesa — e é ela que guarda o seu lugar."
    >
      {!ready ? (
        <div
          style={{
            fontSize: 12,
            color: "#fde68a",
            textAlign: "center",
            letterSpacing: "0.08em",
          }}
        >
          Consultando a Membrana…
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "entrar") {
              void loginForm.handleSubmit(onLogin)(e);
            } else {
              void createForm.handleSubmit(onCreate)(e);
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 15 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
              {mode === "criar" ? "Criar conta" : "Entrar com conta"}
            </span>
            {signup && (
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "criar" ? "entrar" : "criar");
                  loginForm.reset();
                  createForm.reset();
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
                {mode === "criar" ? "Já tenho conta" : "Criar conta"}
              </button>
            )}
          </div>

          {mode === "entrar" ? (
            <>
              <div>
                <label style={FIELD_LABEL} htmlFor="conta-nome">
                  Nome na Ordem
                </label>
                <input
                  id="conta-nome"
                  className="occult-input"
                  style={{ padding: "10px 12px", fontSize: 13 }}
                  placeholder="Como o grupo te chama"
                  maxLength={24}
                  autoComplete="username"
                  autoFocus
                  {...loginForm.register("name")}
                />
                {loginForm.formState.errors.name && (
                  <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>
                    {loginForm.formState.errors.name?.message}
                  </div>
                )}
              </div>

              <div>
                <label style={FIELD_LABEL} htmlFor="conta-senha">
                  Senha
                </label>
                <input
                  id="conta-senha"
                  className="occult-input"
                  style={{ padding: "10px 12px", fontSize: 13 }}
                  type="password"
                  placeholder="Pelo menos 6 caracteres"
                  maxLength={200}
                  autoComplete="current-password"
                  {...loginForm.register("password")}
                />
                {loginForm.formState.errors.password && (
                  <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>
                    {loginForm.formState.errors.password?.message}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label style={FIELD_LABEL} htmlFor="conta-nome">
                  Nome na Ordem
                </label>
                <input
                  id="conta-nome"
                  className="occult-input"
                  style={{ padding: "10px 12px", fontSize: 13 }}
                  placeholder="Como o grupo te chama"
                  maxLength={24}
                  autoComplete="username"
                  autoFocus
                  {...createForm.register("name")}
                />
                {createForm.formState.errors.name && (
                  <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>
                    {createForm.formState.errors.name?.message}
                  </div>
                )}
              </div>

              <div>
                <label style={FIELD_LABEL} htmlFor="conta-senha">
                  Senha
                </label>
                <input
                  id="conta-senha"
                  className="occult-input"
                  style={{ padding: "10px 12px", fontSize: 13 }}
                  type="password"
                  placeholder="Pelo menos 6 caracteres"
                  maxLength={200}
                  autoComplete="new-password"
                  {...createForm.register("password")}
                />
                {createForm.formState.errors.password && (
                  <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>
                    {createForm.formState.errors.password?.message}
                  </div>
                )}
              </div>

              <div>
                <label style={FIELD_LABEL} htmlFor="conta-senha2">
                  Repita a senha
                </label>
                <input
                  id="conta-senha2"
                  className="occult-input"
                  style={{ padding: "10px 12px", fontSize: 13 }}
                  type="password"
                  placeholder="A mesma senha"
                  maxLength={200}
                  autoComplete="new-password"
                  {...createForm.register("password2")}
                />
                {createForm.formState.errors.password2 && (
                  <div style={{ fontSize: 11, color: "#fca5a5", marginTop: 4 }}>
                    {createForm.formState.errors.password2?.message}
                  </div>
                )}
              </div>

              <div style={{ fontSize: 10, color: "#7e6ea8", lineHeight: 1.4 }}>
                Entra já logado. <strong>Não há recuperação de senha</strong> — nem o
                mestre vê ou troca a sua. Anote.
              </div>
            </>
          )}

          {loginForm.formState.errors.root && (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>
              {loginForm.formState.errors.root.message}
            </div>
          )}
          {createForm.formState.errors.root && (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>
              {createForm.formState.errors.root.message}
            </div>
          )}

          <button
            type="submit"
            disabled={
              mode === "entrar"
                ? loginForm.formState.isSubmitting
                : createForm.formState.isSubmitting
            }
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
              cursor: "pointer",
              opacity: 1,
              boxShadow:
                "0 6px 24px rgba(147, 51, 234, 0.45), inset 0 1px 0 rgba(254, 243, 199, 0.35)",
              transition: "all 0.2s ease",
            }}
          >
            {loginForm.formState.isSubmitting || createForm.formState.isSubmitting
              ? "Consultando…"
              : mode === "criar"
                ? "Criar conta e entrar"
                : "Entrar"}
          </button>

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
                value={serverUrl}
                placeholder="Vazio = usar este mesmo servidor"
                onChange={(e) => {
                  // O mesmo endereço vale para as rotas de conta e para o jogo
                  // (ADR #16): quem digita aqui espera entrar NAQUELE servidor.
                  useNetStore.getState().setServerUrl(e.target.value);
                }}
                onBlur={() => void load()}
              />
              <div style={{ fontSize: 11, color: "#7e6ea8", marginTop: 5 }}>
                Deixe em branco para usar o servidor padrão desta URL.
              </div>
            </div>
          )}

          <Link
            to="/local"
            className="occult-btn"
            style={{
              width: "100%",
              padding: "9px 12px",
              background: "transparent",
              borderColor: "rgba(139, 92, 246, 0.25)",
              color: "#b4a5d9",
              textDecoration: "none",
              justifyContent: "center",
              boxSizing: "border-box",
            }}
          >
            <IconMap size={15} />
            Preparar o Mapa Sozinho (Modo Local)
          </Link>
        </form>
      )}
    </Shell>
  );
}
