"""
NDSEP AI-Powered Compliance Gap Analysis (Python)
===================================================
Analyzes an organization's compliance data and generates specific
recommendations with NDPA section references.

Recommendation E6: AI-powered compliance gap analysis

Uses:
  - Organization compliance data from PostgreSQL
  - NDPA section reference mapping
  - Weighted scoring algorithm
"""

import logging
import json
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict, field
from db_helper import get_connection
from worker_base import WorkerBase

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
log = logging.getLogger("ai_gap_analysis")


@dataclass
class ComplianceGap:
    area: str
    severity: str  # critical, high, medium, low
    ndpa_section: str
    title: str
    description: str
    action_items: List[str] = field(default_factory=list)
    estimated_effort: str = ""
    impact_score: int = 0  # 0-100
    current_status: str = "non_compliant"


@dataclass
class GapAnalysisReport:
    org_id: int
    org_name: str
    overall_score: float
    grade: str
    total_gaps: int
    critical_gaps: int
    gaps: List[ComplianceGap] = field(default_factory=list)
    recommendations: List[str] = field(default_factory=list)
    generated_at: str = ""


# NDPA compliance requirements mapping
NDPA_REQUIREMENTS = {
    "registration": {
        "section": "S.44",
        "title": "Registration as Data Controller/Processor of Major Importance",
        "weight": 15,
        "checks": ["has_registration", "registration_current", "category_assigned"],
    },
    "dpo_appointment": {
        "section": "S.40",
        "title": "Appointment of Data Protection Officer",
        "weight": 12,
        "checks": ["has_dpo", "dpo_qualified", "dpo_contact_published"],
    },
    "dpia": {
        "section": "S.39",
        "title": "Data Protection Impact Assessment",
        "weight": 14,
        "checks": ["has_dpia", "dpia_current", "high_risk_assessed"],
    },
    "ropa": {
        "section": "S.42",
        "title": "Records of Processing Activities",
        "weight": 10,
        "checks": ["has_ropa", "ropa_complete", "ropa_updated"],
    },
    "consent_management": {
        "section": "S.25",
        "title": "Lawful Basis and Consent Management",
        "weight": 13,
        "checks": ["consent_recorded", "withdrawal_mechanism", "consent_granular"],
    },
    "breach_response": {
        "section": "S.41",
        "title": "Breach Notification Preparedness",
        "weight": 15,
        "checks": ["breach_plan_exists", "72hr_process", "notification_template"],
    },
    "data_subject_rights": {
        "section": "S.34-38",
        "title": "Data Subject Rights Implementation",
        "weight": 13,
        "checks": ["access_mechanism", "erasure_mechanism", "portability_mechanism", "objection_mechanism"],
    },
    "cross_border": {
        "section": "S.43",
        "title": "Cross-Border Data Transfer Safeguards",
        "weight": 8,
        "checks": ["transfer_instruments", "adequacy_checked", "tia_completed"],
    },
}


class AIGapAnalysis(WorkerBase):
    """AI-powered compliance gap analysis engine."""

    def __init__(self):
        super().__init__("ai_gap_analysis")

    def analyze_organization(self, org_id: int) -> Optional[GapAnalysisReport]:
        """Perform comprehensive compliance gap analysis for an organization."""
        conn = get_connection()
        if not conn:
            log.error("Database unavailable")
            return None

        try:
            cur = conn.cursor()

            # Get org details
            cur.execute("SELECT id, name, sector, compliance_score FROM organizations WHERE id = %s", (org_id,))
            org = cur.fetchone()
            if not org:
                log.error("Organization %d not found", org_id)
                return None

            report = GapAnalysisReport(
                org_id=org[0],
                org_name=org[1] or f"Organization #{org_id}",
                overall_score=0,
                grade="F",
                total_gaps=0,
                critical_gaps=0,
            )

            gaps: List[ComplianceGap] = []
            total_weight = sum(r["weight"] for r in NDPA_REQUIREMENTS.values())
            achieved_weight = 0

            # Check each NDPA requirement area
            for area, req in NDPA_REQUIREMENTS.items():
                area_gaps = self._check_area(cur, org_id, area, req)
                if area_gaps:
                    gaps.extend(area_gaps)
                else:
                    achieved_weight += req["weight"]

            report.gaps = sorted(gaps, key=lambda g: g.impact_score, reverse=True)
            report.total_gaps = len(gaps)
            report.critical_gaps = sum(1 for g in gaps if g.severity == "critical")
            report.overall_score = round((achieved_weight / total_weight) * 100, 1) if total_weight > 0 else 0
            report.grade = self._score_to_grade(report.overall_score)

            # Generate top recommendations
            report.recommendations = [
                f"[{g.severity.upper()}] {g.title} (NDPA {g.ndpa_section}): {g.action_items[0]}"
                for g in report.gaps[:5] if g.action_items
            ]

            from datetime import datetime
            report.generated_at = datetime.utcnow().isoformat()

            log.info(
                "Gap analysis for org %d (%s): score=%.1f%%, grade=%s, gaps=%d (critical=%d)",
                org_id, org[1], report.overall_score, report.grade, report.total_gaps, report.critical_gaps
            )
            return report

        except Exception as e:
            log.error("Gap analysis failed for org %d: %s", org_id, e)
            return None
        finally:
            conn.close()

    def _check_area(self, cur, org_id: int, area: str, req: Dict) -> List[ComplianceGap]:
        """Check a specific compliance area and return gaps."""
        gaps = []

        if area == "registration":
            cur.execute("SELECT registration_status, controller_category FROM organizations WHERE id = %s", (org_id,))
            row = cur.fetchone()
            if not row or row[0] != "approved":
                gaps.append(ComplianceGap(
                    area=area, severity="critical", ndpa_section=req["section"],
                    title="Organization not registered with NDPC",
                    description="NDPA S.44 requires all data controllers of major importance to register with the NDPC.",
                    action_items=["Complete NDPC registration form", "Submit required documentation", "Pay registration fee"],
                    estimated_effort="1-2 weeks", impact_score=95,
                ))

        elif area == "dpo_appointment":
            cur.execute("SELECT COUNT(*) FROM dpo_appointments WHERE organization_id = %s AND status = 'active'", (org_id,))
            count = cur.fetchone()[0]
            if count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="high", ndpa_section=req["section"],
                    title="No Data Protection Officer appointed",
                    description="NDPA S.40 requires appointment of a qualified DPO for organizations processing personal data.",
                    action_items=["Identify qualified DPO candidate", "Register DPO with NDPC", "Publish DPO contact details"],
                    estimated_effort="2-4 weeks", impact_score=85,
                ))

        elif area == "dpia":
            cur.execute("SELECT COUNT(*) FROM dpia_assessments WHERE organization_id = %s", (org_id,))
            count = cur.fetchone()[0]
            if count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="high", ndpa_section=req["section"],
                    title="No Data Protection Impact Assessment conducted",
                    description="NDPA S.39 requires DPIA for high-risk processing activities.",
                    action_items=["Identify high-risk processing activities", "Conduct DPIA using NDSEP wizard", "Document mitigation measures"],
                    estimated_effort="2-3 weeks", impact_score=80,
                ))

        elif area == "ropa":
            cur.execute("SELECT COUNT(*) FROM ropa_records WHERE organization_id = %s", (org_id,))
            count = cur.fetchone()[0]
            if count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="medium", ndpa_section=req["section"],
                    title="No Records of Processing Activities maintained",
                    description="NDPA S.42 requires maintaining records of all processing activities.",
                    action_items=["Use NDSEP ROPA auto-generator", "Document all processing activities", "Review and update quarterly"],
                    estimated_effort="1-2 weeks", impact_score=70,
                ))

        elif area == "consent_management":
            cur.execute("SELECT COUNT(*) FROM consent_records WHERE organization_id = %s", (org_id,))
            count = cur.fetchone()[0]
            if count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="high", ndpa_section=req["section"],
                    title="No consent management system in place",
                    description="NDPA S.25 requires valid consent for processing personal data.",
                    action_items=["Implement consent collection forms", "Create consent withdrawal mechanism", "Maintain consent records"],
                    estimated_effort="2-4 weeks", impact_score=85,
                ))

        elif area == "breach_response":
            cur.execute("SELECT COUNT(*) FROM breach_incidents WHERE organization_id = %s", (org_id,))
            has_plan = cur.fetchone()[0] >= 0  # Having the table means they're aware
            # Check if they have a documented breach plan
            cur.execute("""
                SELECT COUNT(*) FROM compliance_policies
                WHERE organization_id = %s AND policy_type ILIKE '%breach%'
            """, (org_id,))
            plan_count = cur.fetchone()[0]
            if plan_count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="critical", ndpa_section=req["section"],
                    title="No breach notification plan documented",
                    description="NDPA S.41 requires 72-hour notification to NDPC. Without a plan, deadlines will be missed.",
                    action_items=["Create breach response policy", "Define 72-hour notification workflow", "Assign breach response team", "Test with tabletop exercise"],
                    estimated_effort="1-2 weeks", impact_score=90,
                ))

        elif area == "data_subject_rights":
            cur.execute("SELECT COUNT(*) FROM citizen_requests WHERE organization_id = %s", (org_id,))
            dsar_count = cur.fetchone()[0]
            # If zero DSARs, check if they have a mechanism
            if dsar_count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="medium", ndpa_section=req["section"],
                    title="No data subject access request mechanism detected",
                    description="NDPA S.34-38 grants data subjects rights to access, rectify, erase, and port their data.",
                    action_items=["Enable DSAR portal via NDSEP", "Create internal DSAR workflow", "Train staff on response procedures"],
                    estimated_effort="1-2 weeks", impact_score=75,
                ))

        elif area == "cross_border":
            cur.execute("SELECT COUNT(*) FROM transfer_instruments WHERE organization_id = %s", (org_id,))
            transfer_count = cur.fetchone()[0]
            if transfer_count == 0:
                gaps.append(ComplianceGap(
                    area=area, severity="medium", ndpa_section=req["section"],
                    title="No cross-border transfer instruments documented",
                    description="NDPA S.43 requires adequate safeguards for international data transfers.",
                    action_items=["Identify all cross-border data flows", "Implement transfer impact assessments", "Establish appropriate transfer instruments"],
                    estimated_effort="2-4 weeks", impact_score=65,
                ))

        return gaps

    def _score_to_grade(self, score: float) -> str:
        if score >= 90: return "A"
        if score >= 80: return "B"
        if score >= 70: return "C"
        if score >= 60: return "D"
        return "F"


if __name__ == "__main__":
    import sys
    engine = AIGapAnalysis()
    org_id = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    report = engine.analyze_organization(org_id)
    if report:
        print(json.dumps(asdict(report), indent=2, default=str))
