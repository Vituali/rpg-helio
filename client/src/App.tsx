import { useState } from "react";
import FogWarMap from "./components/FogWarMap";
import Lobby from "./components/Lobby";
import Notice from "./components/Notice";
import { useNetStore } from "./state/netStore";

export default function App() {
  const status = useNetStore((s) => s.status);
  const [local, setLocal] = useState(false);

  return (
    <>
      <FogWarMap />
      {!local && status !== "online" && <Lobby onLocal={() => setLocal(true)} />}
      <Notice />
    </>
  );
}
