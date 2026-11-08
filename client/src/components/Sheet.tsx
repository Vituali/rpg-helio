import { useCallback, useState } from "react";
import type { Actor } from "@helio/shared";
import { useNetStore } from "../state/netStore";
import { send } from "../net/bridge";
import { IconClose, IconSave } from "./icons";

/** Drawer da ficha de personagem (character sheet).
 * Somente o dono do ator ou o GM pode editar. */
export default function Sheet({
  actor,
  open,
  onClose,
}: {
  actor: Actor | null;
  open: boolean;
  onClose: () => void;
}) {
  const { you, role } = useNetStore((s) => ({ you: s.you, role: s.role }));
  const isGm = role === "gm";
  const canEdit = isGm || actor?.ownerId === you;
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const isDirty = Object.keys(edits).some((k) => edits[k] !== String(actor?.sheet?.[k] ?? ""));

  const iniciarEdicao = useCallback(() => {
    setEdits(Object.fromEntries(Object.entries(actor?.sheet ?? {}).map(([k, v]) => [k, String(v)])));
  }, [actor?.sheet]);

  const salvar = () => {
    if (!actor || !canEdit) return;
    setSaving(true);
    const next: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(edits)) {
      const n = Number(v);
      next[k] = Number.isFinite(n) && v.trim() !== "" && !v.includes(".") && !v.includes("e") ? n : v;
    }
    send("actor:sheet", { actorId: actor.id, sheet: next });
    setSaving(false);
    onClose();
  };

  if (!open || !actor) return null;

  return (
    <div
      className="vtt-sheet"
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        width: 340,
        maxHeight: "85vh",
        background: "rgba(15, 12, 24, 0.94)",
        border: "1px solid rgba(217, 119, 6, 0.35)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        color: "#eae8f2",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        zIndex: 60,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(217, 119, 6, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
            Ficha — {actor.name}
          </span>
          {actor.ownerId && (
            <span
              style={{
                background: "rgba(34, 197, 94, 0.15)",
                color: "#86efac",
                border: "1px solid rgba(34, 197, 94, 0.35)",
                borderRadius: 4,
                padding: "0 6px",
                fontSize: 10,
              }}
            >
              {isGm ? "Mestre" : actor.ownerId === you ? "Sua ficha" : "Alheia"}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            padding: 2,
          }}
        >
          <IconClose size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {!canEdit && (
          <div style={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>
            Você não pode editar esta ficha.
          </div>
        )}

        {Object.entries(actor.sheet ?? {}).map(([chave, valor]) => (
          <div key={chave} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>
              {chave}
            </label>
            <input
              type="text"
              value={edits[chave] ?? String(valor)}
              onChange={(e) => setEdits((p) => ({ ...p, [chave]: e.target.value }))}
              disabled={!canEdit || saving}
              placeholder="…"
              style={{
                background: "rgba(30, 41, 59, 0.5)",
                border: `1px solid ${canEdit ? "rgba(217, 119, 6, 0.4)" : "rgba(71, 85, 105, 0.3)"}`,
                borderRadius: 6,
                color: "#f1f5f9",
                padding: "6px 10px",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>
        ))}

        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <input
              type="text"
              value={edits["nova-chave"] ?? ""}
              onChange={(e) => setEdits((p) => ({ ...p, ["nova-chave"]: e.target.value }))}
              placeholder="Novo campo…"
              disabled={saving}
              style={{
                flex: 1,
                background: "rgba(30, 41, 59, 0.5)",
                border: "1px solid rgba(71, 85, 105, 0.3)",
                borderRadius: 6,
                color: "#f1f5f9",
                padding: "6px 10px",
                fontSize: 13,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => {
                const chave = edits["nova-chave"]?.trim();
                if (!chave) return;
                setEdits((p) => {
                  const { ["nova-chave"]: _, ...rest } = p;
                  return { ...rest, [chave]: "" };
                });
              }}
              disabled={saving || !edits["nova-chave"]?.trim()}
              style={{
                background: saving ? "#475569" : "#d97706",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                padding: "0 12px",
                fontSize: 12,
                cursor: saving || !edits["nova-chave"]?.trim() ? "default" : "pointer",
              }}
            >
              +
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(217, 119, 6, 0.2)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            iniciarEdicao();
          }}
          disabled={!canEdit || saving}
          style={{
            background: "transparent",
            border: "1px solid rgba(217, 119, 6, 0.3)",
            color: "#d97706",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            cursor: !canEdit || saving ? "default" : "pointer",
          }}
        >
          {saving ? "Gravando…" : "Recarregar"}
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={!canEdit || !isDirty || saving}
          style={{
            background: canEdit && isDirty && !saving ? "#d97706" : "#475569",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            padding: "6px 14px",
            fontSize: 12,
            cursor: !canEdit || !isDirty || saving ? "default" : "pointer",
          }}
        >
          <IconSave size={14} style={{ marginRight: 6 }} />
          Salvar
        </button>
      </div>
    </div>
  );
}
