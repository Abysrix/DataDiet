/**
 * Typed client for the real asset inventory (`/api/v1/assets`).
 *
 * Reads need the server-verified `inventory:read` permission; writes need
 * `assets:write` and are exposed here so the editor can call the same routes the
 * backend already implements. There is deliberately no archive, restore or
 * delete function: those operations are not implemented anywhere in the API.
 */

import { apiGet, apiPatch, apiPost } from "./client";
import type {
  Asset,
  AssetCreateInput,
  AssetListQuery,
  AssetListResponse,
  AssetUpdateInput,
} from "./types";

export const ASSETS_PREFIX = "/api/v1/assets";

/**
 * One page of assets, filtered and paginated server-side.
 *
 * Empty filter strings are omitted rather than sent as `?category=`, because the
 * backend treats a blank as "no filter" and an explicit query string is what the
 * server logs, tests and caches see.
 */
export function listAssets(
  query: AssetListQuery = {},
  signal?: AbortSignal,
): Promise<AssetListResponse> {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.per_page !== undefined) params.set("per_page", String(query.per_page));
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  if (query.sensitivity) params.set("sensitivity", query.sensitivity);
  if (query.source_type) params.set("source_type", query.source_type);
  if (query.lifecycle_status) params.set("lifecycle_status", query.lifecycle_status);
  if (query.institution_id !== undefined) {
    params.set("institution_id", String(query.institution_id));
  }
  const qs = params.toString();
  return apiGet<AssetListResponse>(`${ASSETS_PREFIX}${qs ? `?${qs}` : ""}`, signal);
}

/** One asset, for populating the edit form from the stored row. */
export function getAsset(assetId: number, signal?: AbortSignal): Promise<Asset> {
  return apiGet<Asset>(`${ASSETS_PREFIX}/${assetId}`, signal);
}

/** Creates one asset; the server applies the institution scope and audit trail. */
export function createAsset(input: AssetCreateInput): Promise<Asset> {
  return apiPost<Asset>(ASSETS_PREFIX, input);
}

/** Patches one asset; only fields present in `input` are changed by the API. */
export function updateAsset(assetId: number, input: AssetUpdateInput): Promise<Asset> {
  return apiPatch<Asset>(`${ASSETS_PREFIX}/${assetId}`, input);
}
