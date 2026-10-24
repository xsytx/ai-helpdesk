import { cn } from "@/shared/lib/cn";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/*
 * Questions and answers are plain text with line breaks; the only special
 * thing is a mention, stored as @[Name](u12) and shown as "@Name", a link to
 * that profile. Shown as React elements (never as HTML), so nothing a
 * student types can run in the page.
 */

const MENTION = /@\[([^\]\n]{1,80})\]\(u(\d{1,18})\)/g;

/** A question's or answer's text, with mentions as profile links. */
export function RichText({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <Link key={start} viewTransition to={`/users/${m[2]}`} className="font-semibold text-primary-light hover:underline">
        @{m[1]}
      </Link>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <div className={cn("whitespace-pre-wrap break-words", className)}>{out}</div>;
}

/** The text with mentions as plain "@Name", for previews and the text box. */
export function plainText(text: string): string {
  return text.replace(MENTION, "@$1");
}
