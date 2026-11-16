// Courses (Sprint 6, story 16): programs, their curricula by semester, the
// course catalogue, and the student's own program. Admins import curricula
// pasted from the SDU portal (see backend internal/curricula).
import type { Locale } from "@/i18n/translations";
import { apiClient } from "@/shared/api/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ProgramLevel = "B" | "M" | "DR" | "DS" | string;

export interface Program {
  code: string;
  title: string;
  level: ProgramLevel;
  tag: string;
  cipher: string;
  lang: string;
  faculty: string;
  /** Entry years with an imported curriculum, newest first. */
  years: number[];
}

export interface CourseRef {
  code: string;
  /** "" when the course is not in the catalogue yet. */
  name: string;
  ects: number;
}

export interface CurriculumItem {
  course?: CourseRef;
  /** An elective slot: AE, NAE, NTE… */
  kind?: string;
  label?: string;
  options?: CourseRef[];
  ects: number;
  hours: number;
  marked: boolean;
}

export interface CurriculumSemester {
  number: number;
  ects: number;
  items: CurriculumItem[];
}

export interface CurriculumInfo {
  id: number;
  program_code: string;
  program_title: string;
  lang: string;
  year: number;
  track: string;
  courses: number;
  imported_at: string;
}

export interface Curriculum extends CurriculumInfo {
  program: Program;
  tracks: string[];
  semesters: CurriculumSemester[];
  electives: Record<string, CourseRef[]>;
}

export interface Course {
  code: string;
  name: string;
  theory: number;
  practice: string;
  hours: number;
  ects: number;
  description: string;
  description_kz: string;
  description_ru: string;
}

export interface CoursePlace {
  program_code: string;
  program_title: string;
  lang: string;
  level: ProgramLevel;
  year: number;
  track: string;
  /** 0 = only in an elective list. */
  semester: number;
  /** "" = required; AE, NAE… = elective. */
  kind: string;
  label: string;
}

export interface CourseDetail extends Course {
  places: CoursePlace[];
}

export interface MyProgram {
  program_code: string;
  entry_year: number;
}

/** The course's description in the reader's language, else in English. */
export function courseDescription(c: Course, locale: Locale): string {
  const local = locale === "kz" ? c.description_kz : locale === "ru" ? c.description_ru : c.description;
  return local || c.description || c.description_ru || c.description_kz;
}

/** "MAT 101" ↔ "MAT-101" for links. */
export const courseSlug = (code: string) => code.replace(/\s+/g, "-");
export const courseFromSlug = (slug: string) => slug.replace(/-/g, " ").toUpperCase();

/**
 * The semester a student is in now, from the year they started: autumn (Sept–Jan)
 * is odd, spring (Feb–Aug) even; between 1 and 8.
 */
export function currentSemester(entryYear: number, now = new Date()): number {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const n = m >= 9 ? 2 * (y - entryYear) + 1 : m === 1 ? 2 * (y - entryYear) - 1 : 2 * (y - entryYear);
  return Math.min(8, Math.max(1, n));
}

const keys = {
  programs: ["courses", "programs"] as const,
  curriculum: (program: string, year: number, track: string) => ["courses", "curriculum", program, year, track] as const,
  search: (q: string) => ["courses", "search", q] as const,
  course: (code: string) => ["courses", "course", code] as const,
  mine: ["courses", "mine"] as const,
  curricula: ["courses", "curricula"] as const,
};

export function usePrograms() {
  return useQuery({
    queryKey: keys.programs,
    staleTime: 5 * 60_000,
    queryFn: async () => (await apiClient.get<{ programs: Program[] }>("/programs")).data.programs,
  });
}

/** A program's plan (year 0 = the newest imported, track "" = the main one); null when none is imported. */
export function useCurriculum(program: string | undefined, year = 0, track = "") {
  return useQuery({
    queryKey: keys.curriculum(program ?? "", year, track),
    enabled: Boolean(program),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      try {
        const { data } = await apiClient.get<Curriculum>("/curriculum", {
          params: { program, ...(year ? { year } : {}), ...(track ? { track } : {}) },
        });
        return data;
      } catch (err) {
        if ((err as { response?: { status?: number } }).response?.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useCourseSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: keys.search(query),
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async () => (await apiClient.get<{ courses: Course[] }>("/courses", { params: { q: query } })).data.courses,
  });
}

export function useCourse(code: string) {
  return useQuery({
    queryKey: keys.course(code),
    enabled: Boolean(code),
    queryFn: async () => (await apiClient.get<CourseDetail>(`/courses/${encodeURIComponent(courseSlug(code))}`)).data,
  });
}

export function useMyProgram() {
  return useQuery({
    queryKey: keys.mine,
    queryFn: async () => (await apiClient.get<{ program: MyProgram | null }>("/me/program")).data.program,
  });
}

export function useSetMyProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (p: MyProgram) => (await apiClient.put<{ program: MyProgram }>("/me/program", p)).data.program,
    onSuccess: (p) => queryClient.setQueryData(keys.mine, p),
  });
}

// --- Admin ---

/** What an import of this pasted page would save (parsed on the server). */
export interface CurriculumPreview {
  year: number;
  program_code: string;
  title: string;
  lang: string;
  track: string;
  level: string;
  semesters: {
    number: number;
    items: { course?: { code: string; ects: number }; slot?: { kind: string; label: string; ects: number }; marked: boolean }[];
    /** "Total ects" printed under the semester (0 = not on the page). */
    expected_ects: number;
  }[];
  electives: Record<string, { code: string; name: string }[]>;
  warnings: string[];
  /** "TOTAL ECTS" printed under the plan (0 = not on the page). */
  expected_ects: number;
}

export function usePreviewCurriculum() {
  return useMutation({
    mutationFn: async (text: string) => (await apiClient.post<CurriculumPreview>("/admin/curricula/preview", { text })).data,
  });
}

export function useImportCurriculum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => (await apiClient.post<CurriculumInfo>("/admin/curricula", { text })).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}

export function useCurricula() {
  return useQuery({
    queryKey: keys.curricula,
    queryFn: async () => (await apiClient.get<{ curricula: CurriculumInfo[] }>("/admin/curricula")).data.curricula,
  });
}

export function useDeleteCurriculum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/curricula/${id}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}

export function useUpdateCourse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (c: { code: string; description: string; description_kz: string; description_ru: string }) =>
      (await apiClient.put<Course>(`/admin/courses/${encodeURIComponent(courseSlug(c.code))}`, c)).data,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });
}
