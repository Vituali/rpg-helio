import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

const base = (size = 16, props?: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  ...props,
});

/** Símbolo de O Outro Lado / Ordo Realitas (Sigilo Ocultista) */
export function IconSigil({ size = 22, ...props }: IconProps) {
  return (
    <svg {...base(size, props)} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.7" />
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <polygon points="16,3.5 26.8,22.2 5.2,22.2" stroke="currentColor" strokeWidth="1.2" opacity="0.8" />
      <polygon points="16,28.5 26.8,9.8 5.2,9.8" stroke="currentColor" strokeWidth="1.2" opacity="0.6" />
      <path
        d="M7.5 16C10.5 11.2 13.2 9.5 16 9.5C18.8 9.5 21.5 11.2 24.5 16C21.5 20.8 18.8 22.5 16 22.5C13.2 22.5 10.5 20.8 7.5 16Z"
        fill="rgba(12,7,24,0.85)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
      <ellipse cx="16" cy="16" rx="1" ry="2.6" fill="#07040e" />
    </svg>
  );
}

/** Grande mandala esotérica de fundo (Lobby / Grimoire) */
export function OccultMandala({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 400 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="200" cy="200" r="190" stroke="currentColor" strokeWidth="1" strokeDasharray="6 6" opacity="0.3" />
      <circle cx="200" cy="200" r="176" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
      <circle cx="200" cy="200" r="145" stroke="currentColor" strokeWidth="1" strokeDasharray="2 8" opacity="0.35" />
      <polygon points="200,24 352,288 48,288" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <polygon points="200,376 352,112 48,112" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <rect x="76" y="76" width="248" height="248" transform="rotate(45 200 200)" stroke="currentColor" strokeWidth="0.9" opacity="0.25" />
      <rect x="76" y="76" width="248" height="248" stroke="currentColor" strokeWidth="0.9" opacity="0.25" />
      <circle cx="200" cy="200" r="88" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="200" cy="200" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
      {/* Cardinal runes */}
      <line x1="200" y1="6" x2="200" y2="394" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
      <line x1="6" y1="200" x2="394" y2="200" stroke="currentColor" strokeWidth="0.75" opacity="0.2" />
      <circle cx="200" cy="24" r="5" fill="currentColor" opacity="0.5" />
      <circle cx="200" cy="376" r="5" fill="currentColor" opacity="0.5" />
      <circle cx="24" cy="200" r="5" fill="currentColor" opacity="0.5" />
      <circle cx="376" cy="200" r="5" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

/** Mover / Espadas Cruzadas / Combate */
export function IconMove({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <polyline points="5 9 2 12 5 15" />
      <polyline points="9 5 12 2 15 5" />
      <polyline points="15 19 12 22 9 19" />
      <polyline points="19 9 22 12 19 15" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

/** Mão / Pan (Arrastar câmera no mobile) */
export function IconPan({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/** Parede / Barreira de Pedra */
export function IconWall({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="4" x2="9" y2="10" />
      <line x1="15" y1="4" x2="15" y2="10" />
      <line x1="12" y1="10" x2="12" y2="15" />
      <line x1="8" y1="15" x2="8" y2="20" />
      <line x1="16" y1="15" x2="16" y2="20" />
    </svg>
  );
}

/** Apagar / Purgar Parede */
export function IconErase({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

/** Revelar / Luz / Lanterna Paranormal */
export function IconReveal({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

/** Esconder / Névoa / Escuridão */
export function IconHide({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      <path d="M19 3v4" />
      <path d="M21 5h-4" />
    </svg>
  );
}

/** Setor / Compasso Ritualístico */
export function IconSector({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <polygon points="12 7 17 12 12 17 7 12 12 7" />
    </svg>
  );
}

/** Olho do Mestre (Aberto / Onisciente) */
export function IconEye({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Olho Fechado */
export function IconEyeOff({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** Espadas Cruzadas (Jogador / Agente) */
export function IconSwords({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
      <line x1="13" y1="19" x2="19" y2="13" />
      <line x1="16" y1="16" x2="20" y2="20" />
      <line x1="19" y1="21" x2="21" y2="19" />
      <polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
      <line x1="5" y1="14" x2="9" y2="18" />
      <line x1="7" y1="17" x2="4" y2="20" />
      <line x1="3" y1="19" x2="5" y2="21" />
    </svg>
  );
}

/** Névoa / Bruma */
export function IconMist({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 14h16" />
      <path d="M2 18h14" />
      <path d="M8 10h14" />
      <path d="M6 6h10" />
    </svg>
  );
}

/** Reiniciar / Resetar */
export function IconReset({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/** Lixeira / Destruir */
export function IconTrash({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/** Enquadrar / Fit View */
export function IconFit({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}

/** Imagem / Mapa de Fundo */
export function IconImage({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

/** Exportar / Download */
export function IconDownload({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/** Importar / Upload */
export function IconUpload({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

/** Grupo / Mesa / Jogadores */
export function IconUsers({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Grade / Configurações */
export function IconGrid({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </svg>
  );
}

/** Mapa / Pergaminho */
export function IconMap({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}

/** Cadeado Fechado (Movimento Travado) */
export function IconLock({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** Cadeado Aberto (Movimento Liberado) */
export function IconUnlock({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

/** Pegadas / Caminhada */
export function IconWalk({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="13" cy="4" r="2" />
      <path d="m16 12-2.5-3-3 1.5-2 3.5" />
      <path d="m10.5 10.5-2 5.5-3 3" />
      <path d="m12.5 14 2.5 2v5" />
    </svg>
  );
}

/** Teclado / Atalhos */
export function IconKeyboard({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.001" />
      <path d="M10 8h.001" />
      <path d="M14 8h.001" />
      <path d="M18 8h.001" />
      <path d="M8 12h.001" />
      <path d="M12 12h.001" />
      <path d="M16 12h.001" />
      <path d="M7 16h10" />
    </svg>
  );
}

/** Mais / Adicionar */
export function IconPlus({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Menos / Zoom Out */
export function IconMinus({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Fechar / X */
export function IconClose({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

/** Chevron Cima/Baixo */
export function IconChevron({
  size = 16,
  dir = "down",
  ...props
}: IconProps & { dir?: "up" | "down" | "left" | "right" }) {
  const rot =
    dir === "up" ? 180 : dir === "left" ? 90 : dir === "right" ? -90 : 0;
  return (
    <svg
      {...base(size, props)}
      style={{
        transform: `rotate(${rot}deg)`,
        transition: "transform 0.2s ease",
        ...props.style,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** Grimório / Menu Lateral */
export function IconGrimoire({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <polygon points="12 6 14 10 10 10 12 6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/** Servidor / Conexão */
export function IconServer({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

/** Alerta Paranormal */
export function IconAlert({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

/** Parede Fina / Linha */
export function IconWallThin({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <line x1="12" y1="3" x2="12" y2="21" strokeWidth="2.5" />
      <circle cx="12" cy="6" r="1.5" fill="currentColor" />
      <circle cx="12" cy="18" r="1.5" fill="currentColor" />
    </svg>
  );
}

/** Janela / Grade Transparente */
export function IconWindow({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

/** Teleporte / Portal */
export function IconTeleport({ size = 16, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

/** Enviar mensagem */
export function IconSend({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M5 4l4.5 6-4.5 6L5 20v-4H2l7-6-7-6H5z" />
    </svg>
  );
}

/** Disquete / Salvar */
export function IconSave({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

/** Balão de conversa */
export function IconChat({ size = 14, ...props }: IconProps) {
  return (
    <svg {...base(size, props)}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7c-5.8 0-10.4-4.6-10.4-10.4a9.8 9.8 0 0 1 1-2.9 8.5 8.5 0 0 1 2.2-3.6 8.5 8.5 0 0 1 3-2.4c.7-.2 1.5-.4 2.2-.4z" />
      <path d="M23 11a10 10 0 0 0-.69-2.81L18.6 4.6a23 23 0 0 0-2.74-1.12c-3.42-.51-6.92-.52-10.32-.15a23 23 0 0 0-2.89 1.09L5 11l5 2.5a10 10 0 0 0 5 1.26c2.74 0 5.4-.59 7.89-1.71l3.62-2.5A23 23 0 0 0 23 11z" />
    </svg>
  );
}
