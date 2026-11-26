/**
 * User Management tests mock the directory API module. They fix the contract
 * the page calls and prove writes are reflected only after the server replies.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryUser, UserProfile } from "../api/types";
import { platformAdmin, testUser, withAuth } from "../test/auth";
import UserManagement from "./UserManagement";

const listUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
const upsertMembership = vi.fn();

vi.mock("../api/users", () => ({
  listUsers: (...args: unknown[]) => listUsers(...args),
  createUser: (...args: unknown[]) => createUser(...args),
  updateUser: (...args: unknown[]) => updateUser(...args),
  upsertMembership: (...args: unknown[]) => upsertMembership(...args),
}));

function directoryUser(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: 9,
    email: "reviewer@example.org",
    display_name: "Directory Reviewer",
    is_active: true,
    is_platform_admin: false,
    memberships: [
      {
        id: 4,
        app_user_id: 9,
        institution_id: 1,
        role: "viewer",
        is_active: true,
        created_by: "platform.admin@example.org",
        created_at: "2026-11-27T10:00:00",
      },
    ],
    ...overrides,
  };
}

function renderUsers(user: UserProfile | null = platformAdmin({ institutions: [1, 2] })): void {
  render(
    withAuth(
      <MemoryRouter>
        <UserManagement />
      </MemoryRouter>,
      user,
    ),
  );
}

beforeEach(() => {
  listUsers.mockReset().mockResolvedValue([directoryUser()]);
  createUser.mockReset().mockResolvedValue(directoryUser());
  updateUser.mockReset().mockResolvedValue(directoryUser({ is_active: false }));
  upsertMembership.mockReset().mockResolvedValue(directoryUser());
});

describe("session profile", () => {
  it("shows the role and scope the server verified", () => {
    renderUsers();

    expect(screen.getByRole("heading", { name: /current session profile/i })).toBeInTheDocument();
    expect(screen.getByText("Synthetic Platform Admin")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("All institutions (unscoped)")).toBeInTheDocument();
    expect(screen.getByText("#1, #2")).toBeInTheDocument();
    expect(screen.getByText(/local directory record the server verified/i)).toBeInTheDocument();
    expect(screen.getByText(/not an institutional identity record/i)).toBeInTheDocument();
  });

  it("does not request the directory without users:manage", () => {
    renderUsers(testUser());

    expect(listUsers).not.toHaveBeenCalled();
    expect(screen.getByText(/does not hold users:manage/i)).toBeInTheDocument();
    expect(screen.getByText(/none are attempted here/i)).toBeInTheDocument();
  });

  it("shows an empty session state instead of inventing a profile", () => {
    renderUsers(null);

    expect(screen.getByRole("heading", { name: /no verified session/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to sign in/i })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(listUsers).not.toHaveBeenCalled();
  });
});

describe("directory management", () => {
  it("renders accounts returned by the API", async () => {
    listUsers.mockResolvedValue([directoryUser()]);
    renderUsers();

    expect(await screen.findByText("Directory Reviewer")).toBeInTheDocument();
    expect(screen.getByText("reviewer@example.org")).toBeInTheDocument();
    expect(screen.getByText(/#1 · Viewer · active/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /directory accounts \(1\)/i })).toBeInTheDocument();
  });

  it("creates an account only from the submitted form and reports the server result", async () => {
    renderUsers();
    await screen.findByRole("heading", { name: /directory accounts \(1\)/i });

    await userEvent.type(screen.getByLabelText(/^Email/), "new.reviewer@example.org");
    await userEvent.type(screen.getByLabelText(/^Display name/), "New Reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(createUser).toHaveBeenCalledWith({
        email: "new.reviewer@example.org",
        display_name: "New Reviewer",
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Created account #9");
  });

  it("grants a role through the membership endpoint", async () => {
    renderUsers();
    await screen.findByRole("heading", { name: /directory accounts \(1\)/i });

    await userEvent.selectOptions(screen.getByLabelText(/^Account/), "9");
    await userEvent.selectOptions(screen.getByLabelText(/^Institution/), "1");
    await userEvent.selectOptions(screen.getByLabelText(/^Role/), "reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Grant or change role" }));

    await waitFor(() => {
      expect(upsertMembership).toHaveBeenCalledWith(9, {
        institution_id: 1,
        role: "reviewer",
        is_active: true,
      });
    });
  });

  it("deactivates an account through the update endpoint", async () => {
    renderUsers();
    await screen.findByRole("heading", { name: /directory accounts \(1\)/i });

    await userEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(9, { is_active: false });
    });
  });

  it("shows a refused write as an error, never as a success", async () => {
    createUser.mockRejectedValue(new Error("account already exists"));
    renderUsers();
    await screen.findByRole("heading", { name: /directory accounts \(1\)/i });

    await userEvent.type(screen.getByLabelText(/^Email/), "duplicate@example.org");
    await userEvent.type(screen.getByLabelText(/^Display name/), "Duplicate");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("account already exists");
  });

  it("does not pretend passwords, signup, or identity sync exist", () => {
    renderUsers();

    expect(screen.getByText(/password signup is not implemented/i)).toBeInTheDocument();
    expect(screen.getByText(/no external directory is contacted/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /invite|password|signup|delete account/i }),
    ).toBeNull();
  });
});
