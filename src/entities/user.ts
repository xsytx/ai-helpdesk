export type Role = "student" | "moderator" | "admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
}
