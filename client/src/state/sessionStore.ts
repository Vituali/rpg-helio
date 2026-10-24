import { create } from "zustand";
import { loadSession, type Account } from "../net/auth";

/**
 * Quem está logado neste navegador (ADR #20).
 *
 * A sessão mora num cookie `HttpOnly`: o cliente não a "tem", ele **pergunta**.
 * Este store guarda a resposta e — o que importa para as rotas — o estado "já
 * perguntei". Sem ele, toda visita a `/mesa` piscaria o formulário de entrada
 * antes de descobrir que a pessoa já estava logada.
 *
 * Não guarda senha nem token: nada aqui dá para roubar com um `console.log`.
 */
export interface SessionState {
  /** `false` até a primeira resposta do servidor. As guardas de rota esperam. */
  ready: boolean;
  account: Account | null;
  /** O servidor aceita cadastro novo? (ADR #19) */
  signup: boolean;
  load: () => Promise<void>;
  /** O login/cadastro devolveu a conta: entra sem uma segunda ida ao servidor. */
  accept: (account: Account) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()((set) => ({
  ready: false,
  account: null,
  signup: false,

  load: async () => {
    const s = await loadSession();
    set({ ready: true, account: s.account, signup: s.signup });
  },

  accept: (account) => set({ ready: true, account }),
  clear: () => set({ ready: true, account: null }),
}));
