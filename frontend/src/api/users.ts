/**
 * Typed client for the platform directory routes (`/api/v1/users`).
 *
 * Only accounts holding the server-verified `users:manage` permission can call
 * these routes. No password, magic link, invitation, or institutional identity
 * is accepted: these are local authorization records only.
 */

import { apiGet, apiPatch, apiPost, apiPut } from "./client";
import type {
  DirectoryUser,
  DirectoryUserCreate,
  DirectoryUserUpdate,
  MembershipUpsert,
} from "./types";

export const USERS_PREFIX = "/api/v1/users";

export function listUsers(signal?: AbortSignal): Promise<DirectoryUser[]> {
  return apiGet<DirectoryUser[]>(USERS_PREFIX, signal);
}

export function createUser(data: DirectoryUserCreate): Promise<DirectoryUser> {
  return apiPost<DirectoryUser>(USERS_PREFIX, data);
}

export function updateUser(userId: number, data: DirectoryUserUpdate): Promise<DirectoryUser> {
  return apiPatch<DirectoryUser>(`${USERS_PREFIX}/${userId}`, data);
}

export function upsertMembership(
  userId: number,
  data: MembershipUpsert,
): Promise<DirectoryUser> {
  return apiPut<DirectoryUser>(`${USERS_PREFIX}/${userId}/memberships`, data);
}
