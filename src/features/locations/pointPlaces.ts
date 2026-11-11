// The map points admins keep on the floor plans (advising desk, cloakroom,
// minimarket, labs, Senate Hall…) as searchable places on the Maps page.
// Points linked to a built-in place (the canteen, SSC…) are found through it,
// and rooms through their code (F205), so they are left out here.
import { translations, type Locale } from "@/i18n/translations";
import { TYPE_META, type MapPoint, type PointType } from "./mapPoints";
import type { Place, PlaceKind, SchemeBlock } from "./places";

const LOCALES: Locale[] = ["en", "kz", "ru"];
const tr = (loc: Locale, key: keyof (typeof translations)["en"]) => translations[loc][key];

/** Which category chip a point type belongs to (null = not a place to search for). */
const KIND: Record<PointType, PlaceKind | null> = {
  room: null, lab: "study", office: "service", hall: "study", library: "study", canteen: "food", cafe: "food",
  shop: "food", medical: "service", service: "service", wifi: "rest", toilet: null, staff_toilet: null,
  stairs: null, elevator: null, entrance: null, other: "service",
};

/** The wings on the route map, in plan pixels (x range; above y 980 = inside the wing). */
const WINGS: [SchemeBlock, number, number][] = [
  ["D", 1100, 1436], ["E", 1745, 2098], ["F", 2332, 2689], ["G", 2982, 3316], ["H", 3644, 3990], ["I", 4283, 4655],
];
const blockOf = (p: MapPoint): SchemeBlock | undefined =>
  p.y < 980 ? WINGS.find(([, x1, x2]) => p.x >= x1 && p.x <= x2)?.[0] : undefined;

export const POINT_PLACE_PREFIX = "PT_";
/** The map point id a place code stands for ("PT_42" → "42"), if any. */
export const pointIdOf = (code: string) => (code.startsWith(POINT_PLACE_PREFIX) ? code.slice(POINT_PLACE_PREFIX.length) : undefined);

export function pointPlaces(points: MapPoint[]): Place[] {
  const out: Place[] = [];
  for (const p of points) {
    const kind = KIND[p.type];
    if (!kind || p.place) continue;
    const block = blockOf(p);
    const typeName = (loc: Locale) => tr(loc, TYPE_META[p.type].key);
    const text = (f: (loc: Locale) => string) => ({ en: f("en"), kz: f("kz"), ru: f("ru") });
    out.push({
      code: `${POINT_PLACE_PREFIX}${p.id}`,
      point: p.id,
      kind,
      name: text((loc) => p.name || typeName(loc)),
      where: text((loc) =>
        [
          tr(loc, "mapsFloorTab").replace("{floor}", p.floor),
          block ? tr(loc, "mapsBlock").replace("{block}", block) : "",
          p.name ? typeName(loc) : "",
          p.code,
        ].filter(Boolean).join(" · "),
      ),
      block,
      floor: p.floor === "3B" ? 3 : Number(p.floor),
      aliases: [...LOCALES.map(typeName), p.code].filter(Boolean),
    });
  }
  return out;
}
