"""Create (or promote) the first platform administrator, offline.

Phase 7 (ADR-0014) deliberately offers **no HTTP bootstrap**: production has no
endpoint that can grant administrative rights, because an unauthenticated
privilege-grant endpoint would defeat the entire authorization model. The first
administrator is therefore created by an operator running this script with
direct database access — the same trust boundary as running Alembic.

The script is idempotent and auditable:

* an account with the given email is created, or its ``is_platform_admin``
  flag is raised (never lowered — this script grants, it never revokes);
* optionally, an active membership with the given role is upserted for one
  institution (a platform administrator without any membership reads
  unscoped; memberships are only needed to act *inside* an institution);
* every change is recorded in the audit trail in the same transaction as the
  row change (``users.bootstrap_admin``).

No password is involved anywhere: DataDiet stores no credentials, and identity
is proven by a signed bearer token verified server-side.

Usage (from ``backend/``)::

    ..\\.venv\\Scripts\\python.exe ..\\scripts\\bootstrap_admin.py ^
        --email admin@example.org --display-name "Ops Admin" ^
        --institution-id 1 --role admin

Run it against the same ``DATABASE_URL`` / ``.env`` as the API.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running as a plain script from backend/ or the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.db.models import AppUser, Institution, UserMembership  # noqa: E402
from app.db.session import get_engine  # noqa: E402
from app.services.audit import record_event  # noqa: E402

ROLE_CHOICES = ("viewer", "reviewer", "admin")


def _normalise_email(value: str) -> str:
    cleaned = value.strip().lower()
    if "@" not in cleaned or cleaned.startswith("@") or cleaned.endswith("@"):
        raise argparse.ArgumentTypeError("email must look like an email address")
    return cleaned


def bootstrap(
    db: Session,
    *,
    email: str,
    display_name: str,
    institution_id: int | None,
    role: str,
    actor: str,
) -> int:
    """Create/promote the administrator account; return its id.

    All database changes and their audit events commit together: a crash
    cannot leave an account without its audit entry or vice versa.
    """
    user = db.execute(select(AppUser).where(AppUser.email == email)).scalar_one_or_none()

    if user is None:
        user = AppUser(
            email=email,
            display_name=display_name,
            is_platform_admin=True,
            is_active=True,
        )
        db.add(user)
        db.flush()
        record_event(
            db,
            actor=actor,
            event_type="users.bootstrap_admin",
            entity_type="app_user",
            entity_id=user.id,
            payload={"action": "created", "email": email, "via": "offline_script"},
            commit=False,
        )
        print(f"Created platform administrator account #{user.id} <{email}>.")
    else:
        changed = False
        if not user.is_platform_admin:
            user.is_platform_admin = True
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if changed:
            record_event(
                db,
                actor=actor,
                event_type="users.bootstrap_admin",
                entity_type="app_user",
                entity_id=user.id,
                payload={"action": "promoted", "email": email, "via": "offline_script"},
                commit=False,
            )
            print(f"Promoted existing account #{user.id} <{email}> to platform administrator.")
        else:
            print(f"Account #{user.id} <{email}> is already an active platform administrator.")

    if institution_id is not None:
        institution = db.get(Institution, institution_id)
        if institution is None:
            db.rollback()
            raise SystemExit(
                f"Institution #{institution_id} does not exist; "
                "create it first or omit --institution-id."
            )
        membership = db.execute(
            select(UserMembership).where(
                UserMembership.app_user_id == user.id,
                UserMembership.institution_id == institution_id,
            )
        ).scalar_one_or_none()
        if membership is None:
            db.add(
                UserMembership(
                    app_user_id=user.id,
                    institution_id=institution_id,
                    role=role,
                    is_active=True,
                    created_by=actor,
                )
            )
            record_event(
                db,
                actor=actor,
                event_type="users.membership_upserted",
                entity_type="user_membership",
                entity_id=f"{user.id}:{institution_id}",
                payload={
                    "action": "created",
                    "institution_id": institution_id,
                    "role": role,
                    "is_active": True,
                    "via": "offline_script",
                },
                commit=False,
            )
            print(f"Granted role '{role}' in institution #{institution_id}.")
        elif membership.role != role or not membership.is_active:
            membership.role = role
            membership.is_active = True
            record_event(
                db,
                actor=actor,
                event_type="users.membership_upserted",
                entity_type="user_membership",
                entity_id=f"{user.id}:{institution_id}",
                payload={
                    "action": "updated",
                    "institution_id": institution_id,
                    "role": role,
                    "is_active": True,
                    "via": "offline_script",
                },
                commit=False,
            )
            print(f"Updated membership to active '{role}' in institution #{institution_id}.")
        else:
            print(f"Membership already active '{role}' in institution #{institution_id}.")

    db.commit()
    return user.id


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or promote the first DataDiet platform administrator (offline)."
    )
    parser.add_argument("--email", required=True, type=_normalise_email)
    parser.add_argument(
        "--display-name",
        default=None,
        help="Defaults to the local part of the email address.",
    )
    parser.add_argument(
        "--institution-id",
        type=int,
        default=None,
        help="Optional: also grant an active membership in this institution.",
    )
    parser.add_argument(
        "--role",
        choices=ROLE_CHOICES,
        default="admin",
        help="Role for the optional membership (default: admin).",
    )
    parser.add_argument(
        "--actor",
        default="offline_operator",
        help="Audit actor recorded for this change (default: offline_operator).",
    )
    args = parser.parse_args()

    # Build the engine explicitly so a misconfigured environment fails with a
    # clear message before any change is attempted.
    engine = get_engine()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    display_name = args.display_name or args.email.split("@")[0]

    with factory() as db:
        user_id = bootstrap(
            db,
            email=args.email,
            display_name=display_name,
            institution_id=args.institution_id,
            role=args.role,
            actor=args.actor,
        )
    print(f"Done. Account id: {user_id}. Sign in by issuing a token whose `sub`/`email` "
          f"claim matches {args.email}; the directory, not the token, grants authority.")


if __name__ == "__main__":
    main()
