/** Asset editor contract tests: the API module is mocked, not the browser. */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, UserProfile } from "../api/types";
import { platformAdmin, testUser, withAuth } from "../test/auth";
import AssetEditor from "./AssetEditor";

const createAsset = vi.fn();
const getAsset = vi.fn();
const updateAsset = vi.fn();

vi.mock("../api/assets", () => ({
  createAsset: (...args: unknown[]) => createAsset(...args),
  getAsset: (...args: unknown[]) => getAsset(...args),
  updateAsset: (...args: unknown[]) => updateAsset(...args),
}));

function storedAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 42,
    institution_id: 1,
    data_source_id: 3,
    external_id: "SHOWCASE-ASSET-042",
    title: "Fictional enrolment extract",
    description: "Fictional sample for the showcase.",
    record_type: "dataset",
    category: "enrolment",
    source_type: "showcase_sample",
    file_name: null,
    mime_type: null,
    size_bytes: 2048,
    checksum_sha256: null,
    sensitivity: "confidential",
    contains_personal_data: true,
    duplicate_of_id: null,
    owner_team: "Registry",
    owner_email: "registry@example.org",
    lifecycle_status: "active",
    last_reviewed: "2026-11-01",
    source_created_at: null,
    source_modified_at: null,
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
    ...overrides,
  };
}

/** Scoped institutional admin: platform admins start unscoped by design. */
function scopedAdmin(overrides: Partial<UserProfile> = {}): UserProfile {
  return testUser({ role: "admin", ...overrides });
}

function renderEditor(path: string, user: UserProfile | null = scopedAdmin()): void {
  render(
    withAuth(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/inventory/new" element={<AssetEditor />} />
          <Route path="/inventory/:assetId/edit" element={<AssetEditor />} />
        </Routes>
      </MemoryRouter>,
      user,
    ),
  );
}

beforeEach(() => {
  createAsset.mockReset().mockResolvedValue(storedAsset());
  getAsset.mockReset().mockResolvedValue(storedAsset());
  updateAsset.mockReset().mockResolvedValue(storedAsset());
});

describe("create asset", () => {
  it("posts the form fields to the asset API and reports the returned row", async () => {
    renderEditor("/inventory/new");

    await userEvent.type(screen.getByLabelText(/^External id/), "SHOWCASE-ASSET-050");
    await userEvent.type(screen.getByLabelText(/^Data source id/), "3");
    await userEvent.type(screen.getByLabelText(/^Title/), "Fictional sample asset");
    await userEvent.type(screen.getByLabelText(/^Category/), "finance");
    await userEvent.click(screen.getByRole("button", { name: "Create asset" }));

    await waitFor(() => {
      expect(createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          institution_id: 1,
          data_source_id: 3,
          external_id: "SHOWCASE-ASSET-050",
          title: "Fictional sample asset",
          category: "finance",
          sensitivity: "unknown",
          lifecycle_status: "active",
          size_bytes: 0,
        }),
      );
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Created asset #42");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the scope unset for an unscoped platform administrator", async () => {
    renderEditor("/inventory/new", platformAdmin());

    await userEvent.type(screen.getByLabelText(/^External id/), "SHOWCASE-ASSET-051");
    await userEvent.type(screen.getByLabelText(/^Data source id/), "3");
    await userEvent.type(screen.getByLabelText(/^Title/), "Another sample");
    await userEvent.click(screen.getByRole("button", { name: "Create asset" }));

    await waitFor(() => {
      const payload = createAsset.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("institution_id");
    });
  });

  it("refuses to submit without a valid source id", async () => {
    renderEditor("/inventory/new");

    await userEvent.type(screen.getByLabelText(/^Title/), "Missing source");
    // Submit directly: the browser's native `required` check is not what this
    // test exercises — it checks the form's own guard against a bad source id.
    const form = screen.getByRole("button", { name: "Create asset" }).closest("form");
    if (!form) throw new Error("Asset form was not rendered");
    fireEvent.submit(form);

    expect(await screen.findByRole("alert")).toHaveTextContent(/data source is required/i);
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("shows a refused write as an error, never as a saved asset", async () => {
    createAsset.mockRejectedValue(new Error("institution scope denied"));
    renderEditor("/inventory/new");

    await userEvent.type(screen.getByLabelText(/^External id/), "SHOWCASE-ASSET-052");
    await userEvent.type(screen.getByLabelText(/^Data source id/), "3");
    await userEvent.type(screen.getByLabelText(/^Title/), "Refused sample");
    await userEvent.click(screen.getByRole("button", { name: "Create asset" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("institution scope denied");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("edit asset", () => {
  it("loads the stored row and patches only editable fields", async () => {
    renderEditor("/inventory/42/edit");

    expect(await screen.findByDisplayValue("Fictional enrolment extract")).toBeInTheDocument();
    expect(getAsset).toHaveBeenCalledWith(42, expect.any(AbortSignal));
    expect(screen.getByLabelText(/^External id/)).toBeDisabled();
    expect(screen.getByLabelText(/^Data source id/)).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/^Title/));
    await userEvent.type(screen.getByLabelText(/^Title/), "Renamed fictional extract");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateAsset).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          title: "Renamed fictional extract",
          sensitivity: "confidential",
          lifecycle_status: "active",
        }),
      );
    });
    const payload = updateAsset.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("external_id");
    expect(payload).not.toHaveProperty("data_source_id");
    expect(await screen.findByRole("status")).toHaveTextContent("Saved asset #42");
  });

  it("shows a retryable error when the stored asset cannot be loaded", async () => {
    getAsset.mockRejectedValue(new Error("asset service unavailable"));
    renderEditor("/inventory/42/edit");

    expect(await screen.findByRole("alert")).toHaveTextContent("asset service unavailable");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(updateAsset).not.toHaveBeenCalled();
  });
});

describe("asset editor gates", () => {
  it("does not call the API without assets:write", () => {
    renderEditor("/inventory/new", testUser({ permissions: [] }));

    expect(screen.getByText(/asset writes are not available to this account/i)).toBeInTheDocument();
    expect(createAsset).not.toHaveBeenCalled();
    expect(getAsset).not.toHaveBeenCalled();
  });

  it("offers sign-in instead of a request when signed out", () => {
    renderEditor("/inventory/new", null);

    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("offers no archive, restore, delete or disposal control", () => {
    renderEditor("/inventory/new");

    expect(
      screen.queryByRole("button", { name: /archive|restore|delete|dispose|purge/i }),
    ).toBeNull();
  });
});
