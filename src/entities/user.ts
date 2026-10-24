export type Role = "student" | "moderator" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
  /** "" (initials), a preset id ("avatar3") or an uploaded photo's URL. */
  avatar?: string;
}
