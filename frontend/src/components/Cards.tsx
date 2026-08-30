import { useState } from "react";
import type { Entity, ItemEffect, ItemEntity, RecipeEntity } from "../lib/api.ts";

/* ------------------------------------------------------------------ */
/* Utilidades de rareza y tipos                                        */
/* ------------------------------------------------------------------ */

interface RarityStyle {
  label: string;
  color: string; // texto/borde/accent hex
}

const RARITY_META: Record<string, RarityStyle> = {
  "común": { label: "Común", color: "#94a3b8" },
  "comun": { label: "Común", color: "#94a3b8" },
  "common": { label: "Común", color: "#94a3b8" },
  "raro": { label: "Raro", color: "#38bdf8" },
  "rare": { label: "Raro", color: "#38bdf8" },
  "épico": { label: "Épico", color: "#a78bfa" },
  "epico": { label: "Épico", color: "#a78bfa" },
  "epic": { label: "Épico", color: "#a78bfa" },
  "legendario": { label: "Legendario", color: "#f59e0b" },
  "legendary": { label: "Legendario", color: "#f59e0b" },
  "mítico": { label: "Mítico", color: "#e879f9" },
  "mitico": { label: "Mítico", color: "#e879f9" },
  "mythic": { label: "Mítico", color: "#e879f9" },
};

function rarityStyle(rarity: string): RarityStyle {
  const key = rarity.trim().toLowerCase();
  return RARITY_META[key] ?? { label: rarity || "Común", color: "#94a3b8" };
}

function typeIcon(type: string): React.ReactNode {
  const t = (type ?? "").toLowerCase();
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
  };
  if (t.includes("weapon") || t.includes("arma") || t.includes("chakram") || t.includes("varita") || t.includes("báculo")) {
    return (
      <svg {...common}>
        <path d="M14.5 3.5 20 9l-2 2-1.5-1.5L13 13.5V19l-1 1-1-1v-5.5l-3.5-3.5L6 11l-2-2 5.5-5.5A4 4 0 0 1 14.5 3.5Z" />
        <path d="M12 19v3" />
      </svg>
    );
  }
  if (t.includes("armor") || t.includes("armadura") || t.includes("botas") || t.includes("amuleto") || t.includes("anillo") || t.includes("casco") || t.includes("guante")) {
    return (
      <svg {...common}>
        <path d="M12 3 4 6v5c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  if (t.includes("consumable") || t.includes("consumible") || t.includes("pocion") || t.includes("poción") || t.includes("alimento")) {
    return (
      <svg {...common}>
        <path d="M9 3h6M10 3v5a6 6 0 0 1-4.5 5.8V16h13v-2.2A6 6 0 0 1 14 8V3" />
        <path d="M7 19h10v2H7v-2Z" />
      </svg>
    );
  }
  if (t.includes("resource") || t.includes("recurso") || t.includes("material") || t.includes("tomo") || t.includes("libro") || t.includes("gema") || t.includes("mineral")) {
    return (
      <svg {...common}>
        <path d="M12 2 4 6v12l8 4 8-4V6l-8-4Z" />
        <path d="M4 6l8 4 8-4M12 10v10" />
      </svg>
    );
  }
  if (t.includes("mount") || t.includes("montura")) {
    return (
      <svg {...common}>
        <circle cx="6" cy="14" r="3" />
        <circle cx="18" cy="14" r="3" />
        <path d="M9 14h6M6 11 3 7h4l2 4m9 0 3-4h-4l-2 4" />
      </svg>
    );
  }
  if (t.includes("pet") || t.includes("mascota")) {
    return (
      <svg {...common}>
        <path d="M12 21a8 8 0 0 0 8-8c0-4-3-6-5-6-2 0-3 1.5-3 1.5S11 7 9 7C7 7 4 9 4 13a8 8 0 0 0 8 8Z" />
        <circle cx="8.5" cy="12" r="1" />
        <circle cx="15.5" cy="12" r="1" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 7h18M6 7v13h12V7M9 7V4h6v3" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Emblema (icono) con fallback a imagen oficial                       */
/* ------------------------------------------------------------------ */

function Emblem({ item }: { item: ItemEntity }) {
  const [broken, setBroken] = useState(false);
  const rarity = rarityStyle(item.rarity);

  if (item.imageUrl && !broken) {
    return (
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
        style={{ borderColor: `${rarity.color}66`, background: `${rarity.color}14` }}
      >
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-12 w-12 object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border"
      style={{ borderColor: `${rarity.color}66`, color: rarity.color, background: `${rarity.color}14` }}
    >
      {typeIcon(item.type)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de objeto                                                   */
/* ------------------------------------------------------------------ */

export function ItemCard({ item }: { item: ItemEntity }) {
  const rarity = rarityStyle(item.rarity);
  return (
    <article
      className="flex flex-col overflow-hidden rounded-xl border bg-panel-2/90 shadow-lg transition hover:border-teal/40"
      style={{ borderColor: `${rarity.color}55` }}
    >
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, transparent, ${rarity.color}, transparent)` }} />
      <div className="flex items-start gap-3 p-3.5">
        <Emblem item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-bold text-paper">{item.name}</h4>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: rarity.color, background: `${rarity.color}1a`, border: `1px solid ${rarity.color}44` }}
            >
              {rarity.label}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">
            Nivel {item.level} · {item.type}
            {item.category ? ` · ${item.category}` : ""}
          </p>
        </div>
      </div>

      {item.effects.length > 0 && (
        <ul className="mx-3.5 mb-2 grid grid-cols-1 gap-1 rounded-lg border border-edge/60 bg-ink/40 p-2.5 sm:grid-cols-2">
          {item.effects.map((e: ItemEffect, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-muted">{e.label}</span>
              <span className="shrink-0 font-semibold text-teal">{e.value}</span>
            </li>
          ))}
        </ul>
      )}

      {item.description && <p className="px-3.5 pb-2 text-xs leading-relaxed text-muted">{item.description}</p>}
      {item.obtain && (
        <p className="px-3.5 pb-2 text-xs leading-relaxed text-muted">
          <span className="font-semibold uppercase tracking-wide text-paper">Obtención:</span> {item.obtain}
        </p>
      )}

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto flex items-center justify-between border-t border-edge/60 px-3.5 py-2 text-[11px] font-medium text-teal transition hover:bg-teal/5"
        >
          <span className="font-mono uppercase tracking-wider">Ver en la Enciclopedia</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </a>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de receta                                                   */
/* ------------------------------------------------------------------ */

export function RecipeCard({ recipe }: { recipe: RecipeEntity }) {
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-teal/30 bg-panel-2/90 shadow-lg transition hover:border-teal/50">
      <div className="h-1 w-full bg-gradient-to-r from-transparent via-teal to-transparent" />
      <div className="flex items-start gap-3 p-3.5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-teal/30 bg-teal/10 text-teal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
            <path d="M13 2 4.5 13.5H11L9 22l8.5-11.5H12L13 2Z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-bold text-paper">{recipe.itemName}</h4>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-muted">
            {recipe.profession} · nivel {recipe.professionLevel}
          </p>
        </div>
      </div>

      <div className="mx-3.5 mb-2 flex items-center gap-2 rounded-lg border border-edge/60 bg-ink/40 px-2.5 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted">Produce</span>
        <span className="font-mono text-xs font-bold text-teal">{recipe.yields}×</span>
      </div>

      <ul className="mx-3.5 mb-2 space-y-1 rounded-lg border border-edge/60 bg-ink/40 p-2.5">
        {recipe.ingredients.map((ing, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-paper">
              {ing.isResource ? "▸" : "•"} {ing.name}
            </span>
            <span className="shrink-0 font-mono font-semibold text-ember">{ing.quantity}×</span>
          </li>
        ))}
      </ul>

      {recipe.cost != null && (
        <p className="px-3.5 pb-2 font-mono text-[11px] text-muted">
          Coste orientativo: <span className="font-bold text-ember">{recipe.cost} k</span>
        </p>
      )}

      {recipe.url && (
        <a
          href={recipe.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto flex items-center justify-between border-t border-edge/60 px-3.5 py-2 text-[11px] font-medium text-teal transition hover:bg-teal/5"
        >
          <span className="font-mono uppercase tracking-wider">Ver receta oficial</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
            <path d="M7 17 17 7M9 7h8v8" />
          </svg>
        </a>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Contenedor de tarjetas                                              */
/* ------------------------------------------------------------------ */

export function EntityCards({ entities }: { entities: Entity[] }) {
  if (!entities.length) return null;
  return (
    <div className="mt-3 space-y-2">
      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-teal">
        <span className="h-1 w-1 rounded-full bg-teal" />
        Ficha de archivo oficial
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {entities.map((e) => (e.kind === "item" ? <ItemCard key={`i${e.id}`} item={e} /> : <RecipeCard key={`r${e.id}`} recipe={e} />))}
      </div>
    </div>
  );
}
