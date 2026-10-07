import { useAuth } from "@/app/AuthContext";
import { authenticate, delay, updatePassword } from "@/features/auth/demoAuth";
import { apiClient } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

// No backend for these yet — flip VITE_MOCK_PROFILE=false once /users/me and
// /auth/change-password exist.
const USE_MOCK = import.meta.env.VITE_MOCK_PROFILE !== "false";

/** Map of userId → avatarId (preset id like "avatar3" or a data URL). */
const AVATAR_KEY = "ai_helpdesk_user_avatar";

export const profileKeys = {
  all: ["profile"] as const,
  avatar: (userId: string) => [...profileKeys.all, "avatar", userId] as const,
};

function readAvatarMap(): Record<string, string> {
  const raw = localStorage.getItem(AVATAR_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function fetchAvatar(userId: string): Promise<string | null> {
  if (USE_MOCK) return readAvatarMap()[userId] ?? null;
  const { data } = await apiClient.get<{ avatarId: string | null }>("/users/me");
  return data.avatarId;
}

/** Current user's avatar id, or null when not set. */
export function useUserAvatar() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  return useQuery({
    queryKey: profileKeys.avatar(userId),
    queryFn: () => fetchAvatar(userId),
    enabled: Boolean(userId),
    staleTime: Infinity,
  });
}

export function useUpdateAvatar() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ avatarId }: { avatarId: string }) => {
      if (!user) throw new Error("unauthenticated");
      if (USE_MOCK) {
        await delay();
        // setItem throws QuotaExceededError for oversized images — surfaces as a mutation error.
        localStorage.setItem(AVATAR_KEY, JSON.stringify({ ...readAvatarMap(), [user.id]: avatarId }));
        return avatarId;
      }
      const { data } = await apiClient.patch<{ avatarId: string }>("/users/me", { avatarId });
      return data.avatarId;
    },
    onSuccess: (avatarId) => {
      if (user) qc.setQueryData(profileKeys.avatar(user.id), avatarId);
    },
  });
}

/** Thrown when the server rejects the current password. */
export const WRONG_CURRENT_PASSWORD = "wrong-current-password";

export function usePasswordChange() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      if (!user) throw new Error("unauthenticated");
      if (USE_MOCK) {
        await delay();
        try {
          authenticate(user.email, input.currentPassword);
        } catch {
          throw new Error(WRONG_CURRENT_PASSWORD);
        }
        updatePassword(user.email, input.newPassword);
        return;
      }
      try {
        await apiClient.post("/auth/change-password", input);
      } catch (err) {
        if (isAxiosError(err) && (err.response?.status === 400 || err.response?.status === 401)) {
          throw new Error(WRONG_CURRENT_PASSWORD);
        }
        throw err;
      }
    },
  });
}
