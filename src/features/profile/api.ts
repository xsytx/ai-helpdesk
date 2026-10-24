import { useAuth } from "@/app/AuthContext";
import { apiClient, getErrorStatus } from "@/shared/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { safeStorage } from "@/shared/lib/storage";

import type { User } from "@/entities/user";
import { toReputation, type ApiReputation, type Reputation } from "@/features/reputation/api";
import { toUser, type ApiUser } from "@/features/auth/api";
import { shrinkImage } from "@/shared/lib/image";
import { useEffect, useRef } from "react";
import { AVATAR_SIDE } from "./avatars";

// Avatars are stored with the account on the server (users.avatar) and sent
// with every post, so everyone sees them on every device.

/** The signed-in user's avatar ("" = initials). */
export function useMyAvatar(): string {
  const { user } = useAuth();
  return user?.avatar ?? "";
}

/** Choose a preset (or "" for none), or upload a photo (shrunk to 512px first). */
export type AvatarChoice = { preset: string } | { photo: File };

export function useUpdateAvatar() {
  const { user, updateUser } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (choice: AvatarChoice): Promise<User> => {
      if ("preset" in choice) {
        const { data } = await apiClient.put<ApiUser>("/me/avatar", { avatar: choice.preset });
        return toUser(data);
      }
      const form = new FormData();
      form.append("file", await shrinkImage(choice.photo, AVATAR_SIDE));
      const { data } = await apiClient.post<ApiUser>("/me/avatar", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return toUser(data);
    },
    onSuccess: (next) => {
      if (user) updateUser({ ...user, ...next });
      // Posts on screen carry the old avatar: load them again.
      void qc.invalidateQueries({ queryKey: ["forum"] });
      void qc.invalidateQueries({ queryKey: ["reputation"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

/** Avatars used to be kept only in this browser, by user id. */
const LEGACY_AVATAR_KEY = "ai_helpdesk_user_avatar";

/**
 * Once after the update: an avatar saved only in this browser is moved to
 * the account (if the account has none yet), then forgotten locally.
 */
export function useMoveLegacyAvatar() {
  const { user } = useAuth();
  const update = useUpdateAvatar();
  const tried = useRef(false);
  useEffect(() => {
    if (!user || tried.current) return;
    let map: Record<string, string> = {};
    try {
      map = JSON.parse(safeStorage.get(LEGACY_AVATAR_KEY) ?? "{}") as Record<string, string>;
    } catch {
      map = {};
    }
    const legacy = map[user.id];
    if (!legacy) return;
    tried.current = true;
    const forget = () => {
      delete map[user.id];
      if (Object.keys(map).length) safeStorage.set(LEGACY_AVATAR_KEY, JSON.stringify(map));
      else safeStorage.remove(LEGACY_AVATAR_KEY);
    };
    if (user.avatar) {
      forget();
      return;
    }
    void (async () => {
      try {
        if (legacy.startsWith("data:image/")) {
          const blob = await (await fetch(legacy)).blob();
          await update.mutateAsync({ photo: new File([blob], "avatar", { type: blob.type }) });
        } else {
          await update.mutateAsync({ preset: legacy });
        }
        forget();
      } catch {
        // Try again next time the site opens.
      }
    })();
  }, [user, update]);
}

// --- Public profiles (/users/:id) ---

export interface PublicProfile {
  id: string;
  name: string;
  major: string;
  bio: string;
  avatar: string;
  staff: boolean;
  joinedAt: string;
  questions: number;
  reputation: Reputation;
}

export function useUserProfile(userId: string) {
  return useQuery({
    queryKey: ["users", userId, "profile"],
    enabled: Boolean(userId),
    retry: (count, err) => getErrorStatus(err) !== 404 && count < 1,
    queryFn: async (): Promise<PublicProfile> => {
      const { data } = await apiClient.get<{
        id: number;
        display_name: string;
        major: string;
        bio: string;
        avatar: string;
        staff: boolean;
        created_at: string;
        questions: number;
        reputation: ApiReputation;
      }>(`/users/${userId}`);
      return {
        id: String(data.id),
        name: data.display_name,
        major: data.major,
        bio: data.bio,
        avatar: data.avatar,
        staff: data.staff,
        joinedAt: data.created_at,
        questions: data.questions,
        reputation: toReputation(data.reputation),
      };
    },
  });
}

/** One of a user's answers, with the question it answers. */
export interface ProfileAnswer {
  id: string;
  threadId: string;
  threadTitle: string;
  body: string;
  likes: number;
  isSolution: boolean;
  createdAt: string;
}

export function useUserAnswers(userId: string) {
  return useQuery({
    queryKey: ["users", userId, "answers"],
    enabled: Boolean(userId),
    queryFn: async (): Promise<ProfileAnswer[]> => {
      const { data } = await apiClient.get<{
        comments: { id: number; thread_id: number; thread_title: string; body: string; score: number; is_solution: boolean; created_at: string }[];
      }>(`/users/${userId}/comments`, { params: { page_size: 50 } });
      return data.comments.map((c) => ({
        id: String(c.id),
        threadId: String(c.thread_id),
        threadTitle: c.thread_title,
        body: c.body,
        likes: c.score,
        isSolution: c.is_solution,
        createdAt: c.created_at,
      }));
    },
  });
}

/** Thrown when the server rejects the current password. */
export const WRONG_CURRENT_PASSWORD = "wrong-current-password";

export function usePasswordChange() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      try {
        await apiClient.post("/me/password", {
          current_password: input.currentPassword,
          new_password: input.newPassword,
        });
      } catch (err) {
        if (getErrorStatus(err) === 401) throw new Error(WRONG_CURRENT_PASSWORD);
        throw err;
      }
    },
  });
}
