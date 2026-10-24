import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import FogWarMap from "./components/FogWarMap";
import Notice from "./components/Notice";
import { disconnect } from "./net/socket";
import Entrar from "./screens/Entrar";
import Mesa from "./screens/Mesa";
import { useNetStore } from "./state/netStore";

/**
 * As páginas do HELIO (ADR #21).
 *
 *   /entrar   a conta: entrar ou criar (ADR #20)
 *   /mesa     escolher a missão e ingressar
 *   /         a mesa, com o servidor
 *   /local    a mesa sem servidor, para preparar o mapa
 *
 * A divisão é a decisão: cada página faz **uma pergunta**. A tela única anterior
 * misturava conta, missão, papel e senha de mestre, e mostrava campos que o
 * servidor ignorava.
 *
 * A mesa exige conexão viva: sem ela não há cena autoritativa para desenhar, e
 * cair em `/mesa` é mais honesto do que abrir um mapa vazio. O modo local existe
 * justamente para quem quer o mapa sem servidor.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/mesa" element={<Mesa />} />
        <Route path="/local" element={<LocalTable />} />
        <Route path="/" element={<OnlineTable />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Notice />
    </BrowserRouter>
  );
}

function OnlineTable() {
  const navigate = useNavigate();
  const status = useNetStore((s) => s.status);
  if (status !== "online") return <Navigate to="/mesa" replace />;
  return (
    <FogWarMap
      // Sair da mesa é deixar a sala de verdade (o servidor solta o token), e
      // volta para a escolha da missão — trocar de mesa sem F5 (ADR #21).
      onExit={() => {
        disconnect();
        useNetStore.getState().reset();
        navigate("/mesa", { replace: true });
      }}
    />
  );
}

function LocalTable() {
  const navigate = useNavigate();
  const status = useNetStore((s) => s.status);
  // Já está numa mesa de verdade? Não dá para "preparar sozinho" por cima dela.
  if (status === "online") return <Navigate to="/" replace />;
  return <FogWarMap onExit={() => navigate("/entrar")} />;
}
