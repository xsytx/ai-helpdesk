// Campus places for the navigation page (Sprint 5). Facts come from SDU_info.md
// and the official 3D tour; the list moves to the database with the admin editor.
import type { Locale, TranslationKey } from "@/i18n/translations";
import { searchPlaces as rankPlaces } from "./placeSearch";

export type Text = Record<Locale, string>;
export type PlaceKind = "block" | "food" | "study" | "service" | "rest" | "entrance";
export type Entrance = "C" | "G" | "I";
/** The entrances in the order the switch shows them, and their names. */
export const ENTRANCE_ORDER: Entrance[] = ["C", "G", "I"];
export const ENTRANCE_KEY: Record<Entrance, TranslationKey> = { C: "mapsEntranceC", G: "mapsEntranceG", I: "mapsEntranceI" };
/** Blocks drawn on the campus scheme (see CampusScheme). */
export type SchemeBlock = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
/** Points on the scheme that are not a block: the round lecture halls, the canteen, the medical point. */
export type SchemeSpot = "hallA" | "hallB" | "hallC" | "hallD" | "canteen" | "med";

export interface Place {
  code: string;
  kind: PlaceKind;
  name: Text;
  where: Text;
  /** Block on the scheme to highlight; undefined = not in the main building. */
  block?: SchemeBlock;
  /** A point on the scheme for places outside the blocks (the route ends there). */
  spot?: SchemeSpot;
  /** Room codes that open this place (a lecture hall is both "D117" and "Bochka A"). */
  rooms?: string[];
  floor?: number;
  hours?: string;
  contact?: string;
  aliases: string[];
  popular?: boolean;
  /** A place made from a map point (pointPlaces.ts): that point's id. */
  point?: string;
}

const faculty = (en: string, kz: string, ru: string): Text => ({ en, kz, ru });

export const PLACES: Place[] = [
  {
    code: "RED_CANTEEN", kind: "food", popular: true, spot: "canteen",
    name: { en: "Red Canteen", kz: "Red Canteen асханасы", ru: "Столовая Red Canteen" },
    where: {
      en: "1st floor, across the main corridor from blocks F and G",
      kz: "1-қабат, бас дәліздің F және G блоктарына қарама-қарсы жағы",
      ru: "1 этаж, через главный коридор напротив блоков F и G",
    },
    aliases: ["canteen", "столовая", "асхана", "food", "еда", "тамақ", "lunch", "обед"],
  },
  {
    code: "FOODPOINT", kind: "food",
    name: { en: "SDU Foodpoint", kz: "SDU Foodpoint", ru: "SDU Foodpoint" },
    where: { en: "Main building, 1st and 2nd floors", kz: "Бас ғимарат, 1 және 2-қабат", ru: "Главный корпус, 1 и 2 этажи" },
    aliases: ["food", "еда", "тамақ", "cafe", "кафе", "foodpoint", "food point"],
  },
  {
    code: "H_CANTEEN", kind: "food", block: "H",
    name: { en: "H Canteen", kz: "H асханасы", ru: "Столовая H" },
    where: { en: "Block H", kz: "H блогы", ru: "Блок H" },
    aliases: ["canteen", "столовая", "асхана", "h canteen"],
  },
  {
    code: "RED_COFFEE", kind: "food",
    name: { en: "Red Coffee", kz: "Red Coffee", ru: "Red Coffee" },
    where: { en: "Main building", kz: "Бас ғимарат", ru: "Главный корпус" },
    aliases: ["coffee", "кофе", "кофе-брейк", "кофе ішу"],
  },
  {
    code: "BLUE_CANTEEN", kind: "food",
    name: { en: "Blue Canteen", kz: "Blue Canteen асханасы", ru: "Столовая Blue Canteen" },
    where: { en: "SDU Life building", kz: "SDU Life ғимараты", ru: "Здание SDU Life" },
    aliases: ["canteen", "столовая", "асхана", "sdu life"],
  },
  {
    code: "LIBRARY", kind: "study", popular: true, block: "B", contact: "library@sdu.edu.kz · ext. 184–186",
    name: { en: "Scientific Library", kz: "Ғылыми кітапхана", ru: "Научная библиотека" },
    where: {
      en: "Block B. Floors 0–2: computers (0), study rooms (1), group work (2)",
      kz: "B блогы. 0–2 қабаттар: компьютерлер (0), оқу бөлмелері (1), топтық жұмыс (2)",
      ru: "Блок B. Этажи 0–2: компьютеры (0), учебные комнаты (1), групповая работа (2)",
    },
    aliases: ["research hub", "library", "библиотека", "кітапхана", "study room", "computer", "компьютер", "print", "printer", "принтер"],
  },
  {
    code: "SSC", kind: "service", popular: true, contact: "SSC@sdu.edu.kz · ext. 333, 335",
    name: { en: "Student Service Center (SSC)", kz: "Студенттерге қызмет көрсету орталығы (SSC)", ru: "Центр обслуживания студентов (SSC)" },
    where: {
      en: "1st floor, by the main corridor between blocks D and E",
      kz: "1-қабат, D және E блоктарының арасындағы бас дәліздің жанында",
      ru: "1 этаж, у главного коридора между блоками D и E",
    },
    aliases: ["ssc", "справка", "анықтама", "certificate", "documents", "документы", "құжат"],
  },
  {
    code: "ACCOUNTING", kind: "service", contact: "accounting@sdu.edu.kz · ext. 108",
    name: { en: "Accounting (financial matters)", kz: "Бухгалтерия", ru: "Бухгалтерия" },
    where: { en: "Main building", kz: "Бас ғимарат", ru: "Главный корпус" },
    aliases: ["accounting", "бухгалтерия", "payment", "оплата", "төлем"],
  },
  {
    code: "ADVISING", kind: "service",
    name: { en: "Advising desk", kz: "Эдвайзинг бөлімі (Advising desk)", ru: "Эдвайзинг (Advising desk)" },
    where: {
      en: "1st floor, in the hall between the lecture halls “Bochka B” and “Bochka C”",
      kz: "1-қабат, «B» және «C» бочка дәріс залдарының арасындағы холл",
      ru: "1 этаж, холл между лекционными залами «Бочка B» и «Бочка C»",
    },
    aliases: ["advising", "advisor", "adviser", "advisory", "эдвайзер", "эдвайзинг", "куратор"],
  },
  {
    code: "IELTS_CENTER", kind: "study", block: "E", floor: 1, rooms: ["E105"],
    name: { en: "IDP IELTS test centre (E105)", kz: "IDP IELTS тест орталығы (E105)", ru: "Тестовый центр IDP IELTS (E105)" },
    where: { en: "Block E, 1st floor, room E105: IELTS on computer", kz: "E блогы, 1-қабат, E105: компьютерде IELTS", ru: "Блок E, 1 этаж, E105: IELTS на компьютере" },
    aliases: ["ielts", "idp", "test centre", "test center", "тестовый центр", "тест орталығы", "e105"],
  },
  {
    code: "LANGUAGE_SCHOOL", kind: "study", block: "E", floor: 1, rooms: ["E107"],
    name: { en: "Language school, Extension Center (E107)", kz: "Тіл мектебі, Extension Center (E107)", ru: "Языковая школа при Extension Center (E107)" },
    where: { en: "Block E, 1st floor, room E107", kz: "E блогы, 1-қабат, E107", ru: "Блок E, 1 этаж, E107" },
    aliases: ["language school", "языковая школа", "тіл мектебі", "extension center", "extension centre", "e107"],
  },
  {
    code: "DISTANCE_STUDIO", kind: "study", block: "F", floor: 1, rooms: ["F105"],
    name: { en: "Distance learning studio (F105)", kz: "Қашықтан оқыту студиясы (F105)", ru: "Студия дистанционного обучения (F105)" },
    where: { en: "Block F, 1st floor, room F105", kz: "F блогы, 1-қабат, F105", ru: "Блок F, 1 этаж, F105" },
    aliases: ["studio", "студия", "distance learning", "дистанционное обучение", "қашықтан оқыту", "f105"],
  },
  {
    code: "AI_LAB", kind: "study", block: "I", floor: 1, rooms: ["I105"],
    name: { en: "AI Lab (I105)", kz: "AI Lab (I105)", ru: "AI Lab (I105)" },
    where: { en: "Block I, 1st floor, room I105", kz: "I блогы, 1-қабат, I105", ru: "Блок I, 1 этаж, I105" },
    aliases: ["ai lab", "artificial intelligence", "искусственный интеллект", "жасанды интеллект", "i105"],
  },
  {
    code: "SENATE_HALL", kind: "study", block: "B", floor: 2, rooms: ["B206"],
    name: { en: "Senate Hall (B206)", kz: "Сенат залы (B206)", ru: "Сенатский зал (B206)" },
    where: { en: "Block B, 2nd floor, room B206", kz: "B блогы, 2-қабат, B206", ru: "Блок B, 2 этаж, B206" },
    aliases: ["senate", "сенат", "senate hall", "сенатский зал", "b206"],
  },
  {
    code: "RED_HALL", kind: "study", block: "A", floor: 1,
    name: { en: "Red Hall", kz: "Қызыл зал", ru: "Красный зал" },
    where: { en: "Block A, 1st floor", kz: "A блогы, 1-қабат", ru: "Блок A, 1 этаж" },
    aliases: ["red hall", "красный зал", "қызыл зал"],
  },
  {
    code: "DIGITAL_DEV", kind: "service",
    name: { en: "Digital Development Department", kz: "Цифрлық даму бөлімі", ru: "Отдел цифрового развития" },
    where: { en: "Main building (see the 3D tour; not on the plan yet)", kz: "Бас ғимарат (3D турды қараңыз; жоспарда әлі жоқ)", ru: "Главный корпус (см. 3D-тур; на плане пока нет)" },
    aliases: ["digital development", "цифровое развитие", "цифрового развития", "цифрлық даму", "it department"],
  },
  {
    code: "COUNSELLING", kind: "service", contact: "ext. 246",
    name: { en: "Psychological Counselling Centre", kz: "Психологиялық кеңес орталығы", ru: "Психологическая служба" },
    where: { en: "Main building", kz: "Бас ғимарат", ru: "Главный корпус" },
    aliases: ["psychologist", "психолог", "counselling", "консультация"],
  },
  {
    code: "MEDICAL", kind: "service", popular: true, spot: "med", contact: "ext. 609",
    name: { en: "Medical point", kz: "Медпункт", ru: "Медпункт" },
    where: {
      en: "Main corridor, between blocks G and H",
      kz: "Бас дәліз, G және H блоктарының арасы",
      ru: "Главный коридор, между блоками G и H",
    },
    aliases: ["medical", "doctor", "медпункт", "врач", "дәрігер", "медицина"],
  },
  {
    code: "SDU_LIFE", kind: "rest", popular: true,
    name: { en: "SDU Life", kz: "SDU Life", ru: "SDU Life" },
    where: {
      en: "Separate building: gym, sports court, club rooms, dance hall",
      kz: "Бөлек ғимарат: фитнес-зал, спорт алаңы, клуб бөлмелері, би залы",
      ru: "Отдельное здание: фитнес-зал, спортплощадка, комнаты клубов, танцзал",
    },
    aliases: ["gym", "спортзал", "fitness", "фитнес", "clubs", "клубы", "клуб", "sport", "спорт"],
  },
  {
    code: "RELAX_ZONE", kind: "rest", block: "H", floor: 3,
    name: { en: "Relax zone", kz: "Релакс аймағы", ru: "Релакс-зона" },
    where: {
      en: "Block H, 3rd floor (separate rooms for men and women)",
      kz: "H блогы, 3-қабат (ер және қыз балаларға бөлек)",
      ru: "Блок H, 3 этаж (отдельно для юношей и девушек)",
    },
    aliases: ["relax", "rest", "sleep", "отдых", "поспать", "демалыс"],
  },
  {
    code: "DORM", kind: "rest", contact: "Girls 8778 637 2657 · Boys 8778 727 9567", hours: "Mon–Fri 8:30–17:30, Sat 9:00–14:00",
    name: { en: "Student House (dorm)", kz: "Студенттер үйі (жатақхана)", ru: "Студенческий дом (общежитие)" },
    where: { en: "On campus, about 30 m from the university", kz: "Кампуста, университеттен 30 м жерде", ru: "На кампусе, в 30 м от университета" },
    aliases: ["dorm", "общежитие", "общага", "жатақхана", "student house"],
  },
  {
    code: "BLOCK_D", kind: "block", block: "D",
    name: { en: "Block D", kz: "D блогы", ru: "Блок D" },
    where: faculty("Faculty of Law & Social Sciences", "Құқық және әлеуметтік ғылымдар факультеті", "Факультет права и социальных наук"),
    aliases: ["law", "право", "құқық", "social sciences"],
  },
  {
    code: "BLOCK_E", kind: "block", block: "E", contact: "EH@sdu.edu.kz · ext. 402",
    name: { en: "Block E", kz: "E блогы", ru: "Блок E" },
    where: faculty("Faculty of Education & Humanities", "Педагогика және гуманитарлық ғылымдар факультеті", "Факультет педагогики и гуманитарных наук"),
    aliases: ["education", "педагогика", "humanities", "гуманитарный"],
  },
  {
    code: "BLOCK_F", kind: "block", block: "F",
    name: { en: "Block F", kz: "F блогы", ru: "Блок F" },
    where: faculty("Faculty of Engineering & Natural Sciences", "Инженерия және жаратылыстану ғылымдары факультеті", "Факультет инженерии и естественных наук"),
    aliases: ["engineering", "инженерия", "инженерный", "natural sciences"],
  },
  {
    code: "BLOCK_G", kind: "block", block: "G", contact: "BS@sdu.edu.kz · ext. 602",
    name: { en: "Block G", kz: "G блогы", ru: "Блок G" },
    where: faculty("SDU Business School", "SDU Бизнес мектебі", "Бизнес-школа SDU"),
    aliases: ["business", "бизнес", "business school", "dean of business school"],
  },
  {
    code: "BLOCK_H", kind: "block", block: "H",
    name: { en: "Block H", kz: "H блогы", ru: "Блок H" },
    where: faculty(
      "Teaching wing and the building with a round hall; H Canteen, relax zone on the 3rd floor",
      "Оқу қанаты және дөңгелек холлы бар ғимарат; H асханасы, 3-қабатта релакс аймағы",
      "Учебное крыло и здание с круглым холлом; столовая H, релакс-зона на 3 этаже",
    ),
    aliases: [],
  },
  {
    code: "BLOCK_I", kind: "block", block: "I",
    name: { en: "Block I", kz: "I блогы", ru: "Блок I" },
    where: faculty("The farthest wing, after block H", "H блогынан кейінгі ең шеткі қанат", "Самое дальнее крыло, после блока H"),
    aliases: [],
  },
  {
    code: "BLOCK_A", kind: "block", block: "A",
    name: { en: "Block A", kz: "A блогы", ru: "Блок A" },
    where: faculty("Hall with audience seating, next to the library", "Көрермендер орындары бар зал, кітапхананың жанында", "Зал со зрительскими рядами, рядом с библиотекой"),
    aliases: ["hall", "зал", "assembly"],
  },
  {
    code: "BLOCK_B", kind: "block", block: "B",
    name: { en: "Block B", kz: "B блогы", ru: "Блок B" },
    where: faculty("Library and study zone", "Кітапхана және оқу аймағы", "Библиотека и учебная зона"),
    aliases: [],
  },
  {
    code: "BLOCK_C", kind: "block", block: "C",
    name: { en: "Block C", kz: "C блогы", ru: "Блок C" },
    where: faculty("Main entrance, atrium, info desk, cloakroom", "Бас кіреберіс, атриум, ақпарат үстелі, гардероб", "Главный вход, атриум, инфостойка, гардероб"),
    aliases: ["atrium", "атриум", "cloakroom", "гардероб", "info desk", "main entrance", "главный вход"],
  },
  ...(["A", "B", "C", "D"] as const).map((h): Place => {
    const rooms = { A: ["D117", "D218"], B: ["D116", "D217"], C: ["D113", "D214"], D: ["E117", "E221"] }[h];
    return {
      code: `HALL_${h}`, kind: "study", spot: `hall${h}`, rooms,
      name: { en: `Lecture hall “Bochka ${h}”`, kz: `«${h}» бочка дәріс залы`, ru: `Лекционный зал «Бочка ${h}»` },
      where: {
        en: `Round hall off the main corridor: ${rooms[0]} on the 1st floor, ${rooms[1]} on the 2nd`,
        kz: `Бас дәліздегі дөңгелек зал: 1-қабатта ${rooms[0]}, 2-қабатта ${rooms[1]}`,
        ru: `Круглый зал у главного коридора: ${rooms[0]} на 1 этаже, ${rooms[1]} на 2 этаже`,
      },
      aliases: ["bochka", "бочка", "бочки", "lecture hall", "лекционный", "дәріс", ...rooms.map((r) => r.toLowerCase())],
    };
  }),
  {
    code: "ENTRANCE_C", kind: "entrance", block: "C",
    name: { en: "Entrance C", kz: "C кіреберісі", ru: "Вход C" },
    where: faculty("Main entrance through the atrium (block C)", "Атриум арқылы бас кіреберіс (C блогы)", "Главный вход через атриум (блок C)"),
    aliases: ["entrance", "вход", "кіреберіс", "main entrance", "главный вход"],
  },
  {
    code: "ENTRANCE_G", kind: "entrance", block: "G",
    name: { en: "Entrance G", kz: "G кіреберісі", ru: "Вход G" },
    where: faculty("Side entrance by block G", "G блогының жанындағы бүйір кіреберіс", "Боковой вход у блока G"),
    aliases: ["entrance", "вход", "кіреберіс"],
  },
  {
    code: "ENTRANCE_I", kind: "entrance", block: "I",
    name: { en: "Entrance I", kz: "I кіреберісі", ru: "Вход I" },
    where: faculty(
      "East entrance: the east wall of the big hall under blocks H and I",
      "Шығыс кіреберіс: H және I блоктарының астындағы үлкен холлдың шығыс қабырғасы",
      "Восточный вход: восточная стена большого холла под блоками H и I",
    ),
    aliases: ["entrance", "вход", "кіреберіс", "east entrance", "восточный вход"],
  },
];



/** A room code like "F205": block F, floor 2, room 05. Blocks A–I. */
export interface RoomCode {
  code: string;
  block: string;
  floor: number;
  room: string;
}

export function parseRoomCode(q: string): RoomCode | null {
  const m = /^\s*([A-Ia-i])\s*-?\s*(\d)(\d{2})\s*$/.exec(q);
  if (!m) return null;
  const block = m[1].toUpperCase();
  return { code: `${block}${m[2]}${m[3]}`, block, floor: Number(m[2]), room: m[3] };
}

const BLOCK_PLACE: Partial<Record<string, string>> = { A: "BLOCK_A", B: "BLOCK_B", C: "BLOCK_C", D: "BLOCK_D", E: "BLOCK_E", F: "BLOCK_F", G: "BLOCK_G", H: "BLOCK_H", I: "BLOCK_I" };

/** A place that a room code stands for, e.g. D117 = lecture hall "Bochka A". */
export const placeForRoom = (code: string) => PLACES.find((p) => p.rooms?.includes(code));
export const blockPlace = (block: string) => PLACES.find((p) => p.code === BLOCK_PLACE[block]);


/**
 * Places matching the query in any language, best first (word starts, typos,
 * word endings; see placeSearch.ts). `extra` = more places, e.g. map points.
 */
export function searchPlaces(q: string, extra: Place[] = []): Place[] {
  return rankPlaces(q, [...PLACES, ...extra]);
}
