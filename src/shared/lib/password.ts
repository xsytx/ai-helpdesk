// Password rules for sign up, password reset and password change.
//
// Length matters far more than a mix of character types, which mostly leads
// to predictable passwords like "Password1!" (NIST SP 800-63B makes the same
// call). So: at least 8 characters, not one of the most common passwords,
// and not built from the user's own email or username.
//
// These checks are for the user's benefit; the server only enforces the
// 8-character minimum.

export const MIN_PASSWORD_LENGTH = 8;

// Most common passwords from public breach lists, plus local favourites.
// Compared in lowercase. Shorter ones are already rejected by the length rule.
const COMMON_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "88888888",
  "87654321", "987654321", "11223344", "12341234", "12121212", "123123123",
  "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "zaq12wsx", "q1w2e3r4", "qwer1234",
  "1234qwer", "asdf1234", "abcd1234", "abc12345", "a1234567", "123456a",
  "a123456", "aa123456", "123456qwe", "qwe12345", "qwerty12", "qwerty123",
  "qwerty1234", "qwerty12345", "qwertyui", "qwertyuiop", "asdfghjk",
  "asdfghjkl", "zxcvbnm1", "zxcvbnm123", "1qazxsw2", "password", "password1",
  "password12", "password123", "password!", "passw0rd", "p@ssw0rd",
  "p@ssword", "iloveyou", "iloveyou1", "sunshine", "princess", "football",
  "baseball", "superman", "starwars", "whatever", "trustno1", "welcome1",
  "welcome123", "letmein1", "admin123", "administrator", "computer",
  "michelle", "jennifer", "internet", "monkey123", "dragon123", "master123",
  "football1", "chocolate", "sunshine1", "shadow123", "qazwsxedc",
  "1234abcd", "abcdefgh", "abcdefg1", "aaaaaaaa", "zzzzzzzz", "testtest",
  "test1234", "user1234", "student1", "student123", "kazakhstan",
  "almaty123", "astana123", "sdu12345", "sdu2024", "sdu2025", "sdu2026",
  "йцукенгш", "йцукен123", "пароль123", "qwerty123!", "password1!",
]);

export type PasswordProblem = "tooShort" | "tooCommon" | "hasPersonalInfo";

/**
 * Returns what's wrong with a password, or null if it's fine.
 * `personal` holds things the password shouldn't contain (email name, username).
 */
export function checkPassword(password: string, personal: string[] = []): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "tooShort";
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return "tooCommon";
  const hasPersonal = personal
    .map((p) => p.trim().toLowerCase())
    .some((p) => p.length >= 4 && lower.includes(p));
  if (hasPersonal) return "hasPersonalInfo";
  return null;
}

/** The part of an email before "@" — at SDU, the student ID. */
export function emailName(email: string | undefined): string {
  return (email ?? "").split("@")[0] ?? "";
}
