// Under an AI chat answer about a course ("Is CSS 331 hard?"): a link to each
// course card the answer is about (the backend found them in the question and
// gave the AI their facts and reviews).
import type { ChatCourseRef } from "@/features/chat/api";
import { useLocale } from "@/i18n/LocaleContext";
import { GraduationCap } from "lucide-react";
import { Link } from "react-router-dom";
import { courseSlug } from "../api";

export function CourseLinks({ courses }: { courses?: ChatCourseRef[] }) {
  const { t } = useLocale();
  if (!courses?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {courses.map((c) => (
        <Link
          key={c.code}
          viewTransition
          to={`/courses/${courseSlug(c.code)}`}
          title={t("chatOpenCourse")}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-primary hover:bg-background-2"
        >
          <GraduationCap className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <span className="truncate">
            {c.code} · {c.name}
          </span>
        </Link>
      ))}
    </div>
  );
}
