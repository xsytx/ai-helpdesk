// Views of the official SDU 3D tour (vrmir3d), checked by hand by the team
// (version 3 of the tour). A place, room or map point can have several views:
// the first is the main "Open 3D tour" button, the rest are listed under it.
import type { Text } from "./places";

export interface TourView {
  url: string;
  label: Text;
}

const v = (scene: number, en: string, ru: string, kz: string): TourView => ({
  url: `https://vrmir3d.com/SDU_University_VR/3/#media=${scene}`,
  label: { en, ru, kz },
});

/**
 * By place code (places.ts), room code ("D102") or map point name
 * ("point:sdu store", lower case). Keep the first view the best overall one.
 */
export const TOURS: Record<string, TourView[]> = {
  ENTRANCE_C: [v(3, "Entrance C", "Вход C", "C кіреберісі")],
  RED_HALL: [v(9, "Red Hall", "Красный зал", "Қызыл зал")],
  BLOCK_D: [v(16, "Block D, middle", "Блок D, середина", "D блогы, ортасы")],
  HALL_A: [v(25, "Inside Bochka A", "Внутри бочки A", "A бочкасының іші")],
  HALL_B: [v(21, "Top of Bochka B: study tables", "Над бочкой B: столы для учёбы", "B бочкасының үсті: оқу үстелдері")],
  HALL_C: [v(22, "Top of Bochka C: study tables", "Над бочкой C: столы для учёбы", "C бочкасының үсті: оқу үстелдері")],
  D102: [v(26, "Room D102", "Аудитория D102", "D102 аудиториясы")],
  SSC: [v(27, "Student Service Center", "Центр обслуживания студентов", "Студенттерге қызмет көрсету орталығы")],
  ADVISING: [v(28, "Advising desk", "Эдвайзинг", "Эдвайзинг бөлімі")],
  IELTS_CENTER: [v(29, "IDP IELTS test centre (E105)", "Тестовый центр IDP IELTS (E105)", "IDP IELTS тест орталығы (E105)")],
  LANGUAGE_SCHOOL: [v(30, "Language school (E107)", "Языковая школа (E107)", "Тіл мектебі (E107)")],
  DISTANCE_STUDIO: [v(34, "Distance learning studio (F105)", "Студия дистанционного обучения (F105)", "Қашықтан оқыту студиясы (F105)")],
  AI_LAB: [v(46, "AI Lab (I105)", "AI Lab (I105)", "AI Lab (I105)")],
  SENATE_HALL: [v(8, "Senate Hall", "Сенатский зал", "Сенат залы")],
  DIGITAL_DEV: [v(41, "Digital Development Department", "Отдел цифрового развития", "Цифрлық даму бөлімі")],
  FOODPOINT: [
    v(35, "SDU Foodpoint", "SDU Foodpoint", "SDU Foodpoint"),
    v(36, "Tables", "Столы", "Үстелдер"),
    v(37, "Other side, by the block F entrance", "С другой стороны, у входа в блок F", "Екінші жағы, F блогының кіреберісінде"),
    v(38, "Tables, other side", "Столы с другой стороны", "Екінші жақтағы үстелдер"),
  ],
  LIBRARY: [
    v(4, "1st floor, entrance", "1 этаж, вход", "1-қабат, кіреберіс"),
    v(47, "1st floor, reception", "1 этаж, стойка", "1-қабат, ресепшн"),
    v(48, "1st floor, reading area 1", "1 этаж, читальная зона 1", "1-қабат, оқу аймағы 1"),
    v(49, "1st floor, reading area 2", "1 этаж, читальная зона 2", "1-қабат, оқу аймағы 2"),
    v(50, "1st floor, reading area 3", "1 этаж, читальная зона 3", "1-қабат, оқу аймағы 3"),
    v(51, "Conference room (1st floor)", "Конференц-зал (1 этаж)", "Конференц-зал (1-қабат)"),
    v(10, "2nd floor, entrance (Research Hub)", "2 этаж, вход (Research Hub)", "2-қабат, кіреберіс (Research Hub)"),
    v(59, "2nd floor", "2 этаж", "2-қабат"),
    v(60, "2nd floor, glass room", "2 этаж, стеклянная комната", "2-қабат, шыны бөлме"),
    v(61, "2nd floor, inside 1", "2 этаж, внутри 1", "2-қабат, ішкі 1"),
    v(62, "2nd floor, inside 2", "2 этаж, внутри 2", "2-қабат, ішкі 2"),
    v(63, "2nd floor, inside 3", "2 этаж, внутри 3", "2-қабат, ішкі 3"),
    v(64, "2nd floor, inside 4", "2 этаж, внутри 4", "2-қабат, ішкі 4"),
    v(52, "−1 floor, reception", "−1 этаж, стойка", "−1 қабат, ресепшн"),
    v(53, "−1 floor, computers", "−1 этаж, компьютеры", "−1 қабат, компьютерлер"),
    v(54, "−1 floor, inside 1", "−1 этаж, внутри 1", "−1 қабат, ішкі 1"),
    v(55, "−1 floor, inside 2", "−1 этаж, внутри 2", "−1 қабат, ішкі 2"),
    v(56, "−1 floor, inside 3", "−1 этаж, внутри 3", "−1 қабат, ішкі 3"),
    v(57, "−1 floor, inside 4", "−1 этаж, внутри 4", "−1 қабат, ішкі 4"),
    v(58, "−1 floor, inside 5", "−1 этаж, внутри 5", "−1 қабат, ішкі 5"),
  ],
  MEDICAL: [
    v(65, "Outside, from the atrium", "Снаружи, со стороны атриума", "Сырты, атриум жағынан"),
    v(66, "Therapist", "Кабинет терапевта", "Терапевт кабинеті"),
    v(67, "Procedure room", "Процедурный кабинет", "Емшара кабинеті"),
    v(68, "Ultrasound", "Кабинет УЗИ", "УДЗ кабинеті"),
    v(69, "Ophthalmologist", "Кабинет офтальмолога", "Офтальмолог кабинеті"),
  ],
  SDU_LIFE: [
    v(72, "Hall", "Холл", "Холл"),
    v(70, "Outside", "Снаружи", "Сырты"),
    v(71, "Reception", "Ресепшн", "Ресепшн"),
    v(73, "Blue Hall", "Синий зал", "Көк зал"),
    v(74, "Dance hall", "Танцевальный зал", "Би залы"),
    v(75, "Music hall", "Музыкальный зал", "Музыка залы"),
    v(76, "Sports hall", "Спортивный зал", "Спорт залы"),
    v(77, "Men's gym", "Мужской тренажёрный зал", "Ерлер жаттығу залы"),
    v(78, "Women's gym", "Женский тренажёрный зал", "Әйелдер жаттығу залы"),
  ],
  DORM: [
    v(79, "Block A (Guest House)", "Блок A (Guest House)", "A блогы (Guest House)"),
    v(80, "Block A, reception", "Блок A, ресепшн", "A блогы, ресепшн"),
    v(81, "Block A, hall", "Блок A, холл", "A блогы, холл"),
    v(82, "Block A, guest rooms", "Блок A, гостевые комнаты", "A блогы, қонақ бөлмелері"),
    v(83, "Block A, showers", "Блок A, душевая", "A блогы, душ"),
    v(84, "Block A, coffee zone", "Блок A, кофе-зона", "A блогы, кофе аймағы"),
    v(85, "Block A, lounge 1", "Блок A, комната отдыха 1", "A блогы, демалыс бөлмесі 1"),
    v(86, "Block A, conference hall", "Блок A, конференц-зал", "A блогы, конференц-зал"),
    v(87, "Block A, lounge 2", "Блок A, комната отдыха 2", "A блогы, демалыс бөлмесі 2"),
    v(88, "Block B", "Блок B", "B блогы"),
    v(89, "Block B, reception", "Блок B, ресепшн", "B блогы, ресепшн"),
    v(90, "Block B, billiards", "Блок B, бильярд", "B блогы, бильярд"),
    v(91, "Block B, student canteen 1", "Блок B, студенческая столовая 1", "B блогы, студенттер асханасы 1"),
    v(92, "Block B, student canteen 2", "Блок B, студенческая столовая 2", "B блогы, студенттер асханасы 2"),
    v(93, "Block B, student rooms", "Блок B, комнаты студентов", "B блогы, студенттер бөлмелері"),
    v(94, "Block B, showers", "Блок B, душевая", "B блогы, душ"),
    v(95, "Block B, kitchen", "Блок B, кухня", "B блогы, асүй"),
    v(96, "Block B, lounge", "Блок B, комната отдыха", "B блогы, демалыс бөлмесі"),
  ],
  // Map points (by name, lower case).
  "point:sdu store": [v(6, "SDU Store", "SDU Store", "SDU Store")],
  "point:mini red hall": [v(31, "Mini Red Hall", "Малый красный зал", "Кіші қызыл зал")],
  "point:biology lab": [v(32, "Biology lab", "Лаборатория биологии", "Биология зертханасы")],
  "point:chemistry lab": [v(33, "Chemistry lab", "Лаборатория химии", "Химия зертханасы")],
  "point:wi-fi zone": [v(44, "Wi-Fi zone", "Wi-Fi зона", "Wi-Fi аймағы")],
  "point:minimarket": [
    v(39, "Minimarket, entrance", "Минимаркет, вход", "Минимаркет, кіреберіс"),
    v(40, "Minimarket, inside", "Минимаркет, внутри", "Минимаркет, іші"),
  ],
  "point:library conference room": [v(51, "Conference room", "Конференц-зал", "Конференц-зал")],
};

/** The views for a place code, a room code, or a map point's name. */
export function toursFor(key: string): TourView[] {
  return TOURS[key] ?? TOURS[`point:${key.toLowerCase()}`] ?? [];
}
