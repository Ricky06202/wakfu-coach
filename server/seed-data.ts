/**
 * Dataset de muestra embebido para que el asistente funcione sin red.
 * El contenido es orientativo (resúmenes basados en información pública de
 * Wakfu) y queda marcado como source: "seed". Al ejecutar la ingesta real
 * (wiki.gg / enciclopedia) se enriquece con datos actualizados.
 */

export interface SeedGuide {
  title: string;
  url: string;
  tags: string[];
  summary: string;
  content: string;
}

export interface SeedItem {
  name: string;
  level: number;
  type: string;
  category?: string;
  rarity: string;
  description?: string;
  effects: { label: string; value: string }[];
  obtain?: string;
  /** Imagen oficial de la enciclopedia de Ankama (se puebla durante la ingesta). */
  imageUrl?: string | null;
  url: string;
}

export interface SeedRecipe {
  itemName: string;
  profession: string;
  professionLevel: number;
  yields: number;
  ingredients: { name: string; quantity: number; isResource?: boolean }[];
  cost?: number;
  url: string;
}

export const seedGuides: SeedGuide[] = [
  {
    title: "Ninivix — Guía básica free-to-play de la clase",
    url: "https://wakfu.wiki.gg/wiki/Ninivix",
    tags: ["ninivix", "clase", "f2p", "build", "elementos"],
    summary:
      "Visión general de la clase Ninivix para una cuenta sin abono: rol, elementos, prioridades de stats y consejos de nivelado.",
    content: `
# Ninivix — Guía básica free-to-play

## Rol y estilo
El Ninivix es un mago elemental a media distancia que combina los cuatro elementos
(Fuego, Agua, Aire y Tierra) mediante chakrams y orbes elementales. En grupo suele
actuar de daño (DPS) con utilidad de control. Es una clase ágil que premia la
planificación de la posición del personaje y de los elementos que lanza.

## Elementos
- **Fuego**: daño directo y quemaduras. Bueno para presión constante.
- **Agua**: daño con efectos de control y reposicionamiento de enemigos.
- **Aire**: movilidad y golpes que reducen la iniciativa del rival.
- **Tierra**: control del terreno y daño en área.

Como F2P conviene especializarse en DOS elementos complementarios para no diluir el
equipo y las fichas de pasivas. La combinación clásica es Fuego+Agua (presión) o
Agua+Aire (control y movilidad).

## Prioridad de stats
1. **Inteligencia** para Fuego/Agua (daño mágico).
2. **Agilidad** si priorizas Aire (crítico).
3. **Fuerza** si incluyes Tierra.
4. **Suerte** como stat de apoyo para procs de crítico.
Mantén un buen ratio de **Iniciativa** para actuar antes en combate.

## Consejos de nivelado F2P
- Sigue la misión principal hasta desbloquear las zonas de tu nivel; las misiones
  secundarias de la ciudad dan experiencia y kamás sin coste de abono.
- Recolecta recursos mientras viajas (madera, minerales, plantas) para financiar tus
  primeros oficios.
- No gastes kamás en equipo del mercado de nivel bajo: casi siempre vale la pena
  fabricarlo o dropearlo.
- Entra a las mazmorras de nivel adecuado en grupo; el xp por reto es muy superior.

## Verifica siempre
Los números exactos de daños, áreas y cooldowns cambian entre parches: consulta la
página de la clase en la Wiki Oficial para la versión actual.
`.trim(),
  },
  {
    title: "Progresión F2P eficiente en Wakfu",
    url: "https://wakfu.wiki.gg/wiki/Free_to_play",
    tags: ["f2p", "progresion", "eficiencia", "nivelado"],
    summary:
      "Estrategias para progresar rápido sin abono: prioridad de misiones, experiencia por retos y gestión del tiempo.",
    content: `
# Progresión F2P eficiente en Wakfu

## Mentalidad
Una cuenta sin abono puede llegar muy lejos si se enfoca en lo eficiente: retos de
combate, economía propia y oficios de bajo coste. El abono desbloquea comodidades,
pero no es imprescindible para disfrutar la mayor parte del contenido PvE temprano.

## Qué priorizar
1. **Misión principal**: es la columna vertebral de la experiencia y el nivel.
2. **Retos de mazmorra**: cada reto completado multiplica la experiencia ganada.
   Vale la pena repetir mazmorras accesibles con retos activos.
3. **Oficios de recolección**: madera, mineral, planta y pesca generan recursos que
   siempre tienen demanda.
4. **Crafting simple**: transforma materia prima en objetos con valor añadido.

## Gestión del tiempo
- Dedica las sesiones a un objetivo concreto (nivelar, farmear un recurso, hacer una
  mazmorra concreta) en vez de saltar entre actividades.
- Usa los puntos de energia/oficio cuando se acumulen; no los dejes en el máximo.
- Vende el excedente en el mercado a precio medio; la liquidez mueve la economía.

## Trampas comunes
- Comprar equipo caro que se quedará obsoleto en dos niveles.
- Aceptar todas las misiones secundarias a la vez y perderte.
- Gastar kamás en cosméticos antes de financiar el equipo real.
`.trim(),
  },
  {
    title: "Economía sin abono: qué farmear y qué fabricar",
    url: "https://wakfu.wiki.gg/wiki/Economy",
    tags: ["f2p", "economia", "farm", "recetas", "mercado"],
    summary:
      "Recursos y recetas con buena relación esfuerzo/recompensa para financiar tu cuenta free-to-play.",
    content: `
# Economía sin abono: qué farmear y qué fabricar

## Recursos con demanda constante
- **Minerales** (cobre, hierro, kama…): base de la herrería y siempre necesarios.
- **Madera** y **cortezas**: insumos de la carpintería y la fabricación de flechas.
- **Plantas/raíces**: base de la alquimia (pociones) y de varios consumibles.
- **Pieles y cueros**: insumos del zurrador para equipo de cuero.

## Recetas que añaden valor
- **Pociones de maná y de vida**: consumibles de rotación alta, fáciles de fabricar.
- **Equipo básico de oficio**: fabricar tu propio equipo ahorra kamás y sube el oficio.
- **Materiales refinados**: refinar minerales/maderas antes de venderlos casi siempre
  multiplica el precio final.

## Regla del mercado
Consulta siempre el precio medio antes de vender. El excedente de temporada (eventos)
suele valer más guardado que malvendido en plena cosecha.

## Nota F2P
Algunos oficios tienen límites de nivel para cuentas sin abono. Revisa la tabla de
límites en la Wiki antes de invertir tiempo en uno concreto.
`.trim(),
  },
  {
    title: "Ninivix F2P — Qué objetos y recetas te convienen (niveles 1-60)",
    url: "https://wakfu.wiki.gg/wiki/Ninivix",
    tags: ["ninivix", "f2p", "equipo", "recetas", "build"],
    summary:
      "Objetos y recetas orientativas para equipar a tu Ninivix sin gastar en el mercado.",
    content: `
# Ninivix F2P — Equipamiento por niveles

## Niveles 1-20
Usa equipo de misión y fabrica tu primera varita/chakram. La herrería produce
armas de madera/mineral baratas que superan al loot aleatorio.

## Niveles 20-40
Apuesta por set de cuero (zurrador) para bonus de iniciativa y suerte. La alquimia
cubre tus pociones de maná, que el Ninivix consume rápido por su estilo de lanzar
muchas habilidades.

## Niveles 40-60
Es el momento de refinar minerales y fabricar equipo de nivel medio. Busca piezas
con **Inteligencia** (si vas Fuego/Agua) o **Agilidad** (si vas Aire). El bonus de
set de dos piezas suele rentar más que una pieza suelta de nivel superior.

## Prioridad de inversión
1. Arma actualizada (el daño base es lo más importante).
2. Pociones de maná (tu rotación depende de la reserva).
3. Set con el stat principal al día.
4. Amuletos/anillos de crítico como mejora final.
`.trim(),
  },
];

export const seedItems: SeedItem[] = [
  {
    name: "Chakram de Aprendiz de Ninivix",
    level: 10,
    type: "weapon",
    category: "chakram",
    rarity: "común",
    description:
      "Chakram elemental de iniciación. Permite canalizar los cuatro elementos con pocas restricciones.",
    effects: [
      { label: "Daño", value: "+4-9" },
      { label: "Inteligencia", value: "+5" },
      { label: "Crítico", value: "+2%" },
    ],
    obtain: "Fabricación (herrería) o drops de monstruos de nivel 8-14.",
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    name: "Tomo Elemental Básico",
    level: 15,
    type: "resource",
    category: "libro de hechizo",
    rarity: "raro",
    description:
      "Tomo que enseña una pasiva elemental menor. El Ninivix lo usa para afinar su rotación de elementos.",
    effects: [{ label: "Pasiva", value: "Canalización de un elemento (+1 uso)" }],
    obtain: "Mazmorra de nivel 15 (jefe final) y misiones secundarias.",
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    name: "Botas de Viento Liviano",
    level: 28,
    type: "armor",
    category: "botas",
    rarity: "raro",
    description:
      "Botas ligeras que favorecen la movilidad del mago elemental en el campo de batalla.",
    effects: [
      { label: "Iniciativa", value: "+12" },
      { label: "Agilidad", value: "+8" },
      { label: "PM", value: "+1" },
    ],
    obtain: "Zurraduría (cuero de nivel 28) o drop de trasgos del viento.",
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    name: "Amuleto del Guardián de los Cuatro Templos",
    level: 45,
    type: "armor",
    category: "amuleto",
    rarity: "épico",
    description:
      "Amuleto legendario de los antiguos guardianes ninivix. Amplifica el dominio elemental.",
    effects: [
      { label: "Inteligencia", value: "+18" },
      { label: "Suerte", value: "+10" },
      { label: "Daño elemental", value: "+6%" },
    ],
    obtain: "Misión de cadena del Templo del Fuego y drops de elite.",
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    name: "Varita de Raíz de Bosque",
    level: 35,
    type: "weapon",
    category: "varita",
    rarity: "común",
    description:
      "Varita de madera viva. Opción económica de daño mágico para la fase intermedia.",
    effects: [
      { label: "Daño", value: "+7-14" },
      { label: "Agua", value: "+10%" },
      { label: "Crítico", value: "+3%" },
    ],
    obtain: "Fabricación (carpintería) con madera noble.",
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
];

export const seedRecipes: SeedRecipe[] = [
  {
    itemName: "Chakram de Aprendiz de Ninivix",
    profession: "herrería",
    professionLevel: 8,
    yields: 1,
    ingredients: [
      { name: "Lingote de cobre", quantity: 3, isResource: true },
      { name: "Madera de fresno", quantity: 2, isResource: true },
      { name: "Cuero común", quantity: 1, isResource: true },
    ],
    cost: 250,
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    itemName: "Varita de Raíz de Bosque",
    profession: "carpintería",
    professionLevel: 30,
    yields: 1,
    ingredients: [
      { name: "Madera noble", quantity: 4, isResource: true },
      { name: "Raíz de mana", quantity: 2, isResource: true },
      { name: "Cordel de lino", quantity: 1, isResource: true },
    ],
    cost: 900,
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    itemName: "Botas de Viento Liviano",
    profession: "zurraduría",
    professionLevel: 26,
    yields: 1,
    ingredients: [
      { name: "Cuero de trasgo del viento", quantity: 3, isResource: true },
      { name: "Pluma de grifo joven", quantity: 2, isResource: true },
      { name: "Hilo de algodón", quantity: 1, isResource: true },
    ],
    cost: 700,
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    itemName: "Poción de Maná Menor",
    profession: "alquimia",
    professionLevel: 6,
    yields: 5,
    ingredients: [
      { name: "Hierba azul", quantity: 3, isResource: true },
      { name: "Agua de manantial", quantity: 2, isResource: true },
    ],
    cost: 80,
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    itemName: "Poción de Vida Menor",
    profession: "alquimia",
    professionLevel: 6,
    yields: 5,
    ingredients: [
      { name: "Hoja de sanador", quantity: 3, isResource: true },
      { name: "Agua de manantial", quantity: 2, isResource: true },
    ],
    cost: 80,
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
  {
    itemName: "Amuleto del Guardián de los Cuatro Templos",
    profession: "joyería",
    professionLevel: 42,
    yields: 1,
    ingredients: [
      { name: "Piedra de chakra", quantity: 2, isResource: true },
      { name: "Oro puro", quantity: 1, isResource: true },
      { name: "Gema de fuego", quantity: 1, isResource: true },
    ],
    cost: 4800,
    url: "https://wakfu.com/es/mmorpg/enciclopedia",
  },
];
