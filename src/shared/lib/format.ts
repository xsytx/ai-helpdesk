export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export function isUniversityEmail(email: string): boolean {
  return /^[^\s@]+@sdu\.edu\.kz$/i.test(email.trim());
}

/** 3–20 letters (any alphabet), digits, "_", "." or "-"; no spaces. */
export function isValidUsername(username: string): boolean {
  return /^[\p{L}\p{N}_.-]{3,20}$/u.test(username);
}

export function formatRelativeTime(iso: string, locale: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return locale.startsWith("ru") ? "только что" : locale === "kz" ? "жаңа ғана" : "just now";
  if (diffMin < 60) {
    return locale.startsWith("ru")
      ? `${diffMin} мин. назад`
      : locale === "kz"
        ? `${diffMin} мин бұрын`
        : `${diffMin}m ago`;
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return locale.startsWith("ru")
      ? `${diffH} ч. назад`
      : locale === "kz"
        ? `${diffH} сағ бұрын`
        : `${diffH}h ago`;
  }
  const diffD = Math.floor(diffH / 24);
  return locale.startsWith("ru")
    ? `${diffD} дн. назад`
    : locale === "kz"
      ? `${diffD} күн бұрын`
      : `${diffD}d ago`;
}
