/**
 * The inventory transport: the URL the asset list endpoint is actually called
 * with, and the response shape it returns.
 *
 * These assertions are written against the contract verified in
 * `backend/app/api/routes/assets.py` and `backend/app/api/schemas/assets.py`:
 * `GET /api/v1/assets` takes `page`, `per_page`, `search`, `category`,
 * `sensitivity`, `source_type`, `lifecycle_status` and `institution_id`, and
 * answers with a bare `{items, total, page, per_page, pages}` object — there is
 * no demo envelope around it and no ordering parameter.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createAsset, getAsset, listAssets, updateAsset } from "./assets";
import type { Asset, AssetListResponse } from "./types";

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  } as Response;
}

const PAGE: AssetListResponse = {
  items: [],
  total: 0,
  page: 1,
  per_page: 20,
  pages: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listAssets", () => {
  it("sends every verified query parameter to the asset endpoint", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(PAGE));

    await listAssets({
      page: 2,
      per_page: 20,
      search: "payroll",
      category: "finance",
      sensitivity: "restricted",
      source_type: "hris",
      lifecycle_status: "under_review",
      institution_id: 3,
    });

    expect(spy.mock.calls[0][0]).toBe(
      "/api/v1/assets?page=2&per_page=20&search=payroll&category=finance" +
        "&sensitivity=restricted&source_type=hris&lifecycle_status=under_review" +
        "&institution_id=3",
    );
  });

  it("omits blank filters instead of sending empty query values", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(PAGE));

    await listAssets({
      page: 1,
      per_page: 20,
      search: "",
      category: "",
      sensitivity: undefined,
      lifecycle_status: undefined,
      institution_id: undefined,
    });

    expect(spy.mock.calls[0][0]).toBe("/api/v1/assets?page=1&per_page=20");
  });

  it("calls the endpoint with no query string at all for a bare request", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(PAGE));

    await listAssets();

    expect(spy.mock.calls[0][0]).toBe("/api/v1/assets");
  });

  it("threads the caller's abort signal into the transport", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(PAGE));
    const controller = new AbortController();

    await listAssets({ page: 1 }, controller.signal);

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it("returns the page and its own pagination metadata unchanged", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ...PAGE, total: 41, pages: 3, per_page: 20 }),
    );

    await expect(listAssets({ page: 2 })).resolves.toMatchObject({
      items: [],
      total: 41,
      page: 1,
      per_page: 20,
      pages: 3,
    });
  });
});

describe("asset reads and writes", () => {
  const asset = { id: 12, title: "Fictional asset" } as Asset;

  it("gets one asset by id with the caller's signal", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(asset));
    const controller = new AbortController();

    await expect(getAsset(12, controller.signal)).resolves.toEqual(asset);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/assets/12");
    expect((spy.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });

  it("posts the create body to the asset collection", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(asset));
    const input = {
      data_source_id: 3,
      external_id: "SYNTH-ASSET-012",
      title: "Fictional asset",
      record_type: "dataset",
      sensitivity: "internal" as const,
    };

    await expect(createAsset(input)).resolves.toEqual(asset);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/assets");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))).toEqual(input);
  });

  it("patches only the supplied fields on one asset", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(asset));
    const input = { title: "Renamed fictional asset", sensitivity: "confidential" as const };

    await expect(updateAsset(12, input)).resolves.toEqual(asset);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/assets/12");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((spy.mock.calls[0][1] as RequestInit).body))).toEqual(input);
  });
});
