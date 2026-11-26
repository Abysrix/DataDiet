"""Schemas for the documented risk indicator API (ADR-0032 showcase phase)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RiskIndicatorSchema(BaseModel):
    """One contribution to a stored score, copied verbatim from the rule table."""

    code: str
    label: str
    points: int
    explanation: str


class RiskAssessmentItem(BaseModel):
    """A stored assessment joined to the asset it describes."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    asset_id: int
    asset_title: str
    external_id: str
    institution_id: int | None
    rule_set: str
    score: int
    band: str
    indicators: list[RiskIndicatorSchema]
    assessed_at: datetime


class RiskAssessmentList(BaseModel):
    """One server-paginated page, ordered by descending score."""

    items: list[RiskAssessmentItem]
    total: int
    page: int
    per_page: int
    pages: int


class RiskRuleDescriptor(BaseModel):
    """A rule from `app.services.risk`, exposed so the UI can explain a score."""

    code: str
    label: str
    points: int
    condition: str


class RiskBandDescriptor(BaseModel):
    """An inclusive score range for one band."""

    band: str
    minimum: int
    maximum: int


class RiskRulesResponse(BaseModel):
    rule_set: str
    maximum_score: int
    bands: list[RiskBandDescriptor]
    rules: list[RiskRuleDescriptor]
