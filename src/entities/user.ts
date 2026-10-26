export type Role = "student" | "moderator" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  /** "" (initials), a preset id ("avatar3") or an uploaded photo's URL. */
  avatar?: string;
  /** Muted by staff: can't post or edit until `until` (none = until lifted). */
  mute?: { kind: "mute"; until?: string; reason: string };
}
