import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  BookOpen, Download, Search, FileText, Shield, Users,
  AlertTriangle, Database, Globe, Lock, CheckCircle, ExternalLink, UserPlus
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

interface PolicyTemplate {
  id: string;
  title: string;
  category: string;
  ndpaRef: string;
  description: string;
  icon: React.ElementType;
  color: string;
  pages: number;
  lastUpdated: string;
  tags: string[];
  content: string;
}

const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "privacy-notice",
    title: "Privacy Notice Template",
    category: "Transparency",
    ndpaRef: "NDPA §43",
    description: "Comprehensive privacy notice covering data categories, purposes, legal bases, retention periods, and data subject rights. Suitable for websites, apps, and service providers.",
    icon: Globe,
    color: "text-primary",
    pages: 8,
    lastUpdated: "2024-01-15",
    tags: ["mandatory", "public-facing", "website"],
    content: `# PRIVACY NOTICE

**Organisation:** [Organisation Name]
**Effective Date:** [Date]
**Last Updated:** [Date]

## 1. Introduction
[Organisation Name] ("we", "our", "us") is committed to protecting your personal data in accordance with the Nigeria Data Protection Act 2023 (NDPA) and the Nigeria Data Protection Regulation 2019 (NDPR).

## 2. Data Controller Information
- **Name:** [Organisation Name]
- **Address:** [Address]
- **Email:** [privacy@organisation.com]
- **DPO Contact:** [dpo@organisation.com]

## 3. Personal Data We Collect
We collect the following categories of personal data:
- **Identity Data:** Name, date of birth, NIN, BVN
- **Contact Data:** Email address, phone number, postal address
- **Financial Data:** Bank account details, payment card information
- **Technical Data:** IP address, browser type, device identifiers
- **Usage Data:** How you use our services

## 4. Legal Basis for Processing (NDPA §24)
We process your personal data on the following legal bases:
- **Consent** (§24(1)(a)): Where you have given clear consent
- **Contract** (§24(1)(b)): Where processing is necessary for a contract
- **Legal Obligation** (§24(1)(c)): Where we must comply with a legal requirement
- **Legitimate Interests** (§24(1)(f)): Where our legitimate interests are not overridden by your rights

## 5. Your Rights (NDPA §27)
You have the following rights:
- Right to access your personal data
- Right to rectification of inaccurate data
- Right to erasure ("right to be forgotten")
- Right to restriction of processing
- Right to data portability
- Right to object to processing
- Rights related to automated decision-making

To exercise your rights, contact: [privacy@organisation.com]

## 6. Data Retention
We retain your personal data for [specify period] or as required by applicable law.

## 7. Cross-border Transfers (NDPA §28)
Where we transfer your data outside Nigeria, we ensure adequate safeguards are in place.

## 8. Contact Us
For privacy queries: [privacy@organisation.com]
To lodge a complaint: Nigeria Data Protection Commission (NDPC) — ndpc.gov.ng`
  },
  {
    id: "dpa-template",
    title: "Data Processing Agreement (DPA)",
    category: "Contracts",
    ndpaRef: "NDPA §45",
    description: "Standard DPA for use between Data Controllers and Data Processors. Covers processing instructions, security obligations, sub-processor management, and breach notification.",
    icon: FileText,
    color: "text-blue-600",
    pages: 14,
    lastUpdated: "2024-02-01",
    tags: ["mandatory", "b2b", "processor"],
    content: `# DATA PROCESSING AGREEMENT

**Between:**
**Data Controller:** [Controller Name], [Address] ("Controller")
**Data Processor:** [Processor Name], [Address] ("Processor")

**Effective Date:** [Date]

## 1. Definitions
"Personal Data", "Processing", "Data Subject", "Supervisory Authority" have the meanings given in the NDPA 2023.

## 2. Subject Matter and Duration
2.1 The Processor shall process Personal Data on behalf of the Controller as described in Schedule 1.
2.2 This Agreement shall remain in force until termination of the underlying services agreement.

## 3. Processing Instructions (NDPA §45(2))
3.1 The Processor shall process Personal Data only on documented instructions from the Controller.
3.2 The Processor shall immediately inform the Controller if any instruction infringes applicable data protection law.

## 4. Confidentiality
4.1 The Processor shall ensure that persons authorised to process Personal Data are bound by confidentiality obligations.

## 5. Security Measures (NDPA §48)
The Processor shall implement appropriate technical and organisational measures including:
- Encryption of Personal Data at rest and in transit
- Ongoing confidentiality, integrity, and availability of systems
- Ability to restore access to Personal Data in a timely manner
- Regular testing and evaluation of security measures

## 6. Sub-processors
6.1 The Processor shall not engage sub-processors without prior written consent of the Controller.
6.2 Current approved sub-processors are listed in Schedule 2.

## 7. Data Subject Rights
The Processor shall assist the Controller in fulfilling obligations to respond to data subject rights requests.

## 8. Breach Notification (NDPA §40)
The Processor shall notify the Controller without undue delay (within 24 hours) upon becoming aware of a Personal Data breach.

## 9. Deletion or Return
Upon termination, the Processor shall delete or return all Personal Data as instructed by the Controller.

## Schedule 1: Processing Activities
[Describe categories of data subjects, categories of personal data, processing operations]

## Schedule 2: Approved Sub-processors
[List sub-processors with name, location, and processing activity]`
  },
  {
    id: "ropa-template",
    title: "Record of Processing Activities (ROPA)",
    category: "Records",
    ndpaRef: "NDPA §41",
    description: "Structured ROPA template for documenting all processing activities. Includes data flows, retention schedules, and legal basis mapping for each processing activity.",
    icon: Database,
    color: "text-emerald-600",
    pages: 6,
    lastUpdated: "2024-01-20",
    tags: ["mandatory", "internal", "documentation"],
    content: `# RECORD OF PROCESSING ACTIVITIES (ROPA)

**Organisation:** [Organisation Name]
**DPO:** [DPO Name]
**Last Updated:** [Date]
**Review Frequency:** Annual (or upon material change)

---

## Processing Activity Register

### Activity 1: [Activity Name e.g., Customer Onboarding]

| Field | Details |
|-------|---------|
| **Activity Name** | Customer Onboarding |
| **Department** | [Department] |
| **Purpose** | To verify customer identity and open account |
| **Legal Basis** | Contract (NDPA §24(1)(b)) |
| **Data Categories** | Name, DOB, NIN, address, bank details |
| **Data Subjects** | Customers, prospective customers |
| **Recipients** | Internal: Compliance, Operations; External: Credit Bureau |
| **Third Country Transfers** | None / [Country + Safeguard] |
| **Retention Period** | 7 years from account closure (CAMA 2020) |
| **Security Measures** | Encryption, access controls, audit logs |
| **DPO Notes** | DPIA required: No / Yes (see DPIA-001) |

---

### Activity 2: [Activity Name e.g., Employee HR Processing]

| Field | Details |
|-------|---------|
| **Activity Name** | Employee HR Management |
| **Department** | Human Resources |
| **Purpose** | Employment administration, payroll, performance management |
| **Legal Basis** | Contract (NDPA §24(1)(b)); Legal obligation (§24(1)(c)) |
| **Data Categories** | Name, NIN, BVN, salary, performance records, health data |
| **Data Subjects** | Current and former employees |
| **Recipients** | Internal: Finance, Management; External: FIRS, NSITF, Pension |
| **Third Country Transfers** | None |
| **Retention Period** | 6 years after employment ends |
| **Security Measures** | HR system access controls, encrypted payroll |
| **DPO Notes** | Special category data (health): explicit consent obtained |

---

*Add additional rows for each processing activity*

## ROPA Review Log

| Date | Reviewer | Changes Made |
|------|----------|-------------|
| [Date] | [Name] | Initial creation |`
  },
  {
    id: "dpia-template",
    title: "Data Protection Impact Assessment (DPIA)",
    category: "Risk",
    ndpaRef: "NDPA §35",
    description: "Full DPIA template for high-risk processing activities. Covers necessity assessment, risk identification, mitigation measures, and DPO consultation requirements.",
    icon: Shield,
    color: "text-purple-400",
    pages: 10,
    lastUpdated: "2024-01-10",
    tags: ["mandatory", "high-risk", "assessment"],
    content: `# DATA PROTECTION IMPACT ASSESSMENT (DPIA)

**Project/System Name:** [Name]
**Assessment Date:** [Date]
**DPO:** [DPO Name]
**Status:** Draft / Under Review / Approved

---

## Part 1: Necessity and Proportionality

### 1.1 Description of Processing
Describe the nature, scope, context, and purposes of the processing:
[Describe what data is being processed, how, by whom, and why]

### 1.2 Is a DPIA Required? (NDPA §35)
A DPIA is required where processing is likely to result in high risk. Check all that apply:
- [ ] Systematic and extensive profiling with significant effects
- [ ] Large-scale processing of special category data
- [ ] Systematic monitoring of publicly accessible areas
- [ ] New technologies or novel use of existing technologies
- [ ] Processing that prevents individuals from exercising rights
- [ ] Children's data at scale

**Conclusion:** DPIA [Required / Not Required] because: [reason]

### 1.3 Necessity Assessment
Is the processing necessary and proportionate to the purpose?
- **Purpose:** [State purpose]
- **Minimum data used:** Yes / No — [explain]
- **Retention limited:** Yes / No — [explain]
- **Legal basis:** [State basis under NDPA §24]

---

## Part 2: Risk Identification

| Risk | Likelihood (1-5) | Impact (1-5) | Risk Score | Mitigation |
|------|-----------------|--------------|------------|------------|
| Unauthorised access | 3 | 4 | 12 | Encryption, access controls |
| Data breach | 2 | 5 | 10 | Incident response plan |
| Purpose creep | 2 | 3 | 6 | Data minimisation controls |
| [Add more risks] | | | | |

---

## Part 3: Mitigation Measures

| Measure | Owner | Target Date | Status |
|---------|-------|-------------|--------|
| Implement encryption | IT | [Date] | Planned |
| Staff training | HR | [Date] | Planned |
| Access review | IT | [Date] | Planned |

---

## Part 4: DPO Consultation (NDPA §35(4))

**DPO Opinion:** [Approve / Approve with conditions / Reject]
**DPO Comments:** [Comments]
**DPO Signature:** _________________ **Date:** _______

---

## Part 5: Residual Risk Assessment

After mitigation, is the residual risk acceptable?
- [ ] Yes — proceed with processing
- [ ] No — escalate to NDPC before proceeding (NDPA §35(5))`
  },
  {
    id: "breach-response",
    title: "Data Breach Response Plan",
    category: "Incident",
    ndpaRef: "NDPA §40",
    description: "Incident response playbook for data breaches. Covers detection, containment, NDPC notification within 72 hours, data subject notification, and post-incident review.",
    icon: AlertTriangle,
    color: "text-rose-400",
    pages: 7,
    lastUpdated: "2024-02-10",
    tags: ["mandatory", "incident", "72-hour"],
    content: `# DATA BREACH RESPONSE PLAN

**Organisation:** [Organisation Name]
**DPO:** [DPO Name]
**Version:** 1.0 | **Last Updated:** [Date]

---

## Phase 1: Detection & Initial Assessment (0–2 hours)

### Immediate Actions
1. **Contain** the breach — isolate affected systems if necessary
2. **Preserve** evidence — do not delete logs or data
3. **Notify** the DPO and IT Security Lead immediately
4. **Document** the time of discovery and initial facts

### Initial Assessment Checklist
- [ ] What data was affected? (categories, volume, sensitivity)
- [ ] How many data subjects are affected?
- [ ] What is the likely cause? (hack, human error, lost device)
- [ ] Is the breach ongoing or contained?
- [ ] Could the breach result in risk to individuals?

---

## Phase 2: NDPC Notification (within 72 hours — NDPA §40(2))

**Notification threshold:** Notify NDPC if the breach is likely to result in risk to rights and freedoms of individuals.

### NDPC Notification Must Include:
- Nature of the personal data breach
- Categories and approximate number of data subjects concerned
- Categories and approximate number of records concerned
- Name and contact details of DPO
- Likely consequences of the breach
- Measures taken or proposed to address the breach

**NDPC Notification Portal:** [ndpc.gov.ng/breach-notification]
**NDPC Emergency Line:** [+234-xxx-xxx-xxxx]

---

## Phase 3: Data Subject Notification (NDPA §40(3))

Notify affected data subjects **without undue delay** if the breach is likely to result in **high risk** to their rights and freedoms.

### Notification Must Include:
- Description of the breach in plain language
- Name and contact details of DPO
- Likely consequences of the breach
- Measures taken to address the breach
- Steps data subjects can take to protect themselves

---

## Phase 4: Containment & Recovery

| Action | Owner | Timeline |
|--------|-------|----------|
| Reset compromised credentials | IT | Immediate |
| Patch vulnerability | IT | 24 hours |
| Notify affected third parties | Legal | 48 hours |
| Restore from backup | IT | As needed |

---

## Phase 5: Post-Incident Review (within 30 days)

- Root cause analysis
- Lessons learned
- Policy/procedure updates
- Staff retraining if required
- Update ROPA and risk register

---

## Breach Log

| Date | Type | Data Affected | Subjects | NDPC Notified | Resolved |
|------|------|--------------|----------|---------------|----------|
| | | | | | |`
  },
  {
    id: "consent-form",
    title: "Data Subject Consent Form",
    category: "Consent",
    ndpaRef: "NDPA §25",
    description: "Granular consent form template meeting NDPA requirements. Covers freely given, specific, informed, and unambiguous consent with easy withdrawal mechanisms.",
    icon: CheckCircle,
    color: "text-amber-400",
    pages: 3,
    lastUpdated: "2024-01-25",
    tags: ["mandatory", "public-facing", "consent"],
    content: `# DATA SUBJECT CONSENT FORM

**Organisation:** [Organisation Name]
**Purpose:** [Specific purpose for which consent is sought]
**Date:** [Date]

---

## Your Consent

We would like to use your personal data for the purpose(s) described below. Please read this carefully before giving your consent.

### What data we will use:
[List specific data categories — e.g., name, email, phone number, location data]

### Why we want to use it:
[State specific purpose — e.g., to send you marketing communications about our products and services]

### Legal basis:
Your consent (NDPA 2023 §24(1)(a) and §25)

### How long we will keep it:
[State retention period — e.g., until you withdraw consent or 3 years, whichever is earlier]

### Who we may share it with:
[List any third parties — e.g., our marketing partner, [Name], for joint campaigns]

---

## Your Rights

You have the right to:
- **Withdraw consent** at any time without affecting the lawfulness of processing before withdrawal
- **Access** the personal data we hold about you
- **Correct** inaccurate data
- **Delete** your data (subject to legal obligations)
- **Lodge a complaint** with the NDPC at ndpc.gov.ng

---

## Consent Declaration

I, **[Full Name]**, hereby give my **freely given, specific, informed, and unambiguous consent** to [Organisation Name] to process my personal data as described above.

| Consent Item | Yes | No |
|-------------|-----|-----|
| Marketing emails | ☐ | ☐ |
| SMS notifications | ☐ | ☐ |
| Third-party sharing | ☐ | ☐ |
| Profiling for personalisation | ☐ | ☐ |

**Signature:** _________________ **Date:** _______

**To withdraw consent:** Email [privacy@organisation.com] or call [phone number]`
  },
  {
    id: "dsar-procedure",
    title: "Data Subject Access Request (DSAR) Procedure",
    category: "Rights",
    ndpaRef: "NDPA §27",
    description: "Internal procedure for handling data subject rights requests. Covers verification, response timelines, exemptions, and escalation paths within the 30-day statutory deadline.",
    icon: Users,
    color: "text-indigo-400",
    pages: 5,
    lastUpdated: "2024-02-05",
    tags: ["internal", "procedure", "rights"],
    content: `# DATA SUBJECT ACCESS REQUEST (DSAR) PROCEDURE

**Owner:** Data Protection Officer
**Version:** 1.0 | **Last Updated:** [Date]
**Statutory Deadline:** 30 days from receipt (NDPA §27)

---

## 1. Receiving a Request

A DSAR may be received via:
- Email to [privacy@organisation.com]
- Written letter to [address]
- Online form at [URL]
- Verbally (must be documented immediately)

**Log all requests in the DSAR Register immediately upon receipt.**

---

## 2. Verify Identity (within 5 days)

Before processing, verify the requester's identity to prevent unauthorised disclosure:
- Request government-issued ID (NIN slip, passport, driver's licence)
- For requests on behalf of another person, require proof of authority

**Do not process the request until identity is verified.**

---

## 3. Assess the Request (within 10 days)

Determine:
- [ ] Is this a valid DSAR under NDPA §27?
- [ ] Does an exemption apply? (legal privilege, third-party data, ongoing investigation)
- [ ] Is an extension needed? (complex/numerous requests — notify requester within 30 days)
- [ ] Which departments hold relevant data?

---

## 4. Gather and Review Data (within 20 days)

- Search all systems: CRM, HR, email, databases, paper files
- Redact third-party personal data
- Apply any applicable exemptions
- Prepare a clear, intelligible response

---

## 5. Respond (within 30 days of receipt)

Response must include:
- Confirmation that data is/is not processed
- Copy of personal data in structured, machine-readable format
- Information on: purposes, legal basis, recipients, retention period, rights

**Response format:** Secure email / encrypted USB / secure portal

---

## 6. DSAR Register

| Ref | Date Received | Requester | Type | Verified | Response Date | Status |
|-----|--------------|-----------|------|----------|---------------|--------|
| DSAR-001 | | | Access | | | |

---

## 7. Escalation

If a request is refused or complex, escalate to the DPO and Legal team. Document all decisions with reasons.`
  },
  {
    id: "retention-policy",
    title: "Data Retention & Disposal Policy",
    category: "Lifecycle",
    ndpaRef: "NDPA §46",
    description: "Comprehensive retention schedule covering all data categories with statutory retention periods under Nigerian law. Includes secure disposal procedures for physical and digital records.",
    icon: Lock,
    color: "text-muted-foreground",
    pages: 9,
    lastUpdated: "2024-01-30",
    tags: ["mandatory", "internal", "lifecycle"],
    content: `# DATA RETENTION AND DISPOSAL POLICY

**Organisation:** [Organisation Name]
**Owner:** DPO / Compliance
**Version:** 1.0 | **Last Updated:** [Date]

---

## 1. Purpose

This policy establishes retention periods for personal data processed by [Organisation Name] in compliance with NDPA 2023 §46 and applicable Nigerian law.

---

## 2. Retention Schedule

### 2.1 Customer/Client Data

| Data Category | Retention Period | Legal Basis |
|--------------|-----------------|-------------|
| Customer contracts | 7 years after expiry | CAMA 2020 §404 |
| Transaction records | 7 years | FIRS Act |
| KYC/AML records | 5 years after relationship ends | MLPA 2022 |
| Customer complaints | 3 years after resolution | CBN Guidelines |
| Marketing consent | Until withdrawal + 1 year | NDPA §25 |

### 2.2 Employee Data

| Data Category | Retention Period | Legal Basis |
|--------------|-----------------|-------------|
| Employment contracts | 6 years after termination | Limitation Act |
| Payroll records | 6 years | PITA 2011 |
| Performance reviews | 3 years after termination | Best practice |
| Disciplinary records | 6 years after termination | Limitation Act |
| Health/medical records | 10 years after termination | Employees Compensation Act |

### 2.3 Financial Data

| Data Category | Retention Period | Legal Basis |
|--------------|-----------------|-------------|
| Accounting records | 7 years | CAMA 2020 |
| Tax records | 6 years | FIRS Act |
| Audit reports | 7 years | CAMA 2020 |

### 2.4 Technical/System Data

| Data Category | Retention Period | Legal Basis |
|--------------|-----------------|-------------|
| System access logs | 1 year | Security best practice |
| CCTV footage | 30 days | NDPA proportionality |
| Website cookies | Per cookie policy | NDPA §43 |

---

## 3. Disposal Procedures

### 3.1 Digital Data
- Overwrite storage media using DoD 5220.22-M standard (7-pass)
- Use certified data destruction software
- Obtain certificate of destruction from vendor

### 3.2 Physical Records
- Cross-cut shredding (DIN 66399 Level P-4 minimum)
- Use certified shredding service with certificate of destruction
- Do not place unshredded personal data in general waste

---

## 4. Retention Review

Conduct annual review of this schedule. Update when:
- New legislation is enacted
- New data categories are introduced
- Business processes change`
  },
  {
    id: "cross-border-transfer",
    title: "Cross-Border Transfer Assessment",
    category: "Transfers",
    ndpaRef: "NDPA §28",
    description: "Transfer Impact Assessment (TIA) template for international data transfers. Covers adequacy decisions, Standard Contractual Clauses (SCCs), BCRs, and derogations under NDPA §28.",
    icon: Globe,
    color: "text-teal-400",
    pages: 8,
    lastUpdated: "2024-02-15",
    tags: ["mandatory", "international", "assessment"],
    content: `# CROSS-BORDER DATA TRANSFER ASSESSMENT

**Organisation:** [Organisation Name]
**Transfer Reference:** TIA-[Year]-[Number]
**Assessment Date:** [Date]
**DPO Review:** [Date]

---

## 1. Transfer Details

| Field | Details |
|-------|---------|
| **Sending Entity** | [Organisation Name, Nigeria] |
| **Receiving Entity** | [Entity Name, Country] |
| **Data Categories** | [e.g., customer names, emails, financial data] |
| **Data Subjects** | [e.g., Nigerian customers] |
| **Volume** | [Approximate number of records] |
| **Frequency** | [Continuous / Daily / Monthly] |
| **Purpose** | [e.g., cloud storage, payroll processing] |

---

## 2. Transfer Mechanism (NDPA §28)

Select the applicable transfer mechanism:

- [ ] **Adequacy Decision** — NDPC has determined the destination country provides adequate protection
  - Country: ________________
  - Decision Reference: ________________

- [ ] **Standard Contractual Clauses (SCCs)** — NDPC-approved SCCs executed between parties
  - SCC Version: ________________
  - Execution Date: ________________

- [ ] **Binding Corporate Rules (BCRs)** — Approved BCRs within corporate group
  - BCR Approval Reference: ________________

- [ ] **Derogation** (NDPA §28(5)) — Transfer is necessary for:
  - [ ] Performance of a contract with the data subject
  - [ ] Vital interests of the data subject
  - [ ] Establishment, exercise, or defence of legal claims
  - [ ] Explicit consent of the data subject

---

## 3. Destination Country Assessment

### 3.1 Legal Framework
- Does the destination country have data protection legislation? Yes / No
- Is there an independent supervisory authority? Yes / No
- Are there effective remedies for data subjects? Yes / No

### 3.2 Government Access Risk
- Risk of government access to transferred data: Low / Medium / High
- Justification: [Explain]

---

## 4. Supplementary Measures

If transfer mechanism alone is insufficient, implement:
- [ ] End-to-end encryption (data encrypted before transfer, keys held in Nigeria)
- [ ] Pseudonymisation before transfer
- [ ] Contractual restrictions on onward transfers
- [ ] Regular audits of recipient's compliance

---

## 5. DPO Assessment

**Conclusion:** Transfer is / is not permissible under NDPA §28 because:
[Explanation]

**DPO Signature:** _________________ **Date:** _______`
  },
];

const CATEGORIES = ["All", "Transparency", "Contracts", "Records", "Risk", "Incident", "Consent", "Rights", "Lifecycle", "Transfers"];

const DEMO_DPCO_ORG_ID = 1;

export default function DpcoPolicyHub() {
  const { user } = useAuth();
  const dpcoOrgId = (user as any)?.dpcoOrgId ?? DEMO_DPCO_ORG_ID;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [previewTemplate, setPreviewTemplate] = useState<PolicyTemplate | null>(null);
  const [assignTemplate, setAssignTemplate] = useState<PolicyTemplate | null>(null);
  const [assignClientId, setAssignClientId] = useState("");
  const [assignNotes, setAssignNotes] = useState("");

  const clientsQuery = trpc.dpco.listClients.useQuery({ dpcoOrgId });
  const assignMutation = trpc.dpco.assignClientPolicy.useMutation({
    onSuccess: () => {
      toast.success(`Policy template assigned to client successfully`);
      setAssignTemplate(null);
      setAssignClientId("");
      setAssignNotes("");
    },
    onError: (err) => toast.error(`Assignment failed: ${err.message}`),
  });

  const filtered = POLICY_TEMPLATES.filter(t => {
    const matchSearch = !search || t.title.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()) || t.tags.some(tag => tag.includes(search.toLowerCase()));
    const matchCat = category === "All" || t.category === category;
    return matchSearch && matchCat;
  });

  const handleAssign = () => {
    if (!assignTemplate || !assignClientId) return;
    assignMutation.mutate({
      dpcoOrgId,
      clientId: parseInt(assignClientId),
      templateId: assignTemplate.id,
      templateTitle: assignTemplate.title,
      notes: assignNotes || undefined,
    });
  };

  const handleDownload = (template: PolicyTemplate) => {
    const blob = new Blob([template.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${template.id}-template.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded: ${template.title}`);
  };

  return (
    <div className="px-6 py-6 space-y-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/" }, { label: "Dpco Policy Hub" }]} className="mb-4" />
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary font-mono">DPCO Policy Hub</h1>
          <p className="text-muted-foreground text-sm mt-1">
            NDPA 2023-compliant policy templates for Data Protection Compliance Organisations
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-emerald-600" />
          <span>{POLICY_TEMPLATES.length} templates · Updated Q1 2024</span>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="pl-9 bg-card border-input text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <Button
              key={cat}
              size="sm"
              variant={category === cat ? "default" : "outline"}
              onClick={() => setCategory(cat)}
              className={category === cat ? "bg-primary text-white" : "border-input text-foreground text-xs"}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Template Grid */}
      {previewTemplate ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setPreviewTemplate(null)} className="border-input text-foreground">
                ← Back to Library
              </Button>
              <h2 className="text-foreground font-semibold">{previewTemplate.title}</h2>
              <Badge className="text-xs bg-muted text-foreground border-input">{previewTemplate.ndpaRef}</Badge>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => handleDownload(previewTemplate)}>
              <Download className="w-4 h-4 mr-2" /> Download .md
            </Button>
          </div>
          <div className="bg-background border border-border rounded-lg p-6 max-h-[70vh] overflow-y-auto">
            <pre className="text-foreground text-sm font-mono whitespace-pre-wrap leading-relaxed">{previewTemplate.content}</pre>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(template => {
            const Icon = template.icon;
            return (
              <div key={template.id} className="bg-card border border-border rounded-lg p-5 hover:border-muted-foreground transition-all flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
                      <Icon className={`w-5 h-5 ${template.color}`} />
                    </div>
                    <div>
                      <div className="text-foreground font-medium text-sm leading-tight">{template.title}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge className="text-xs bg-muted/50 text-muted-foreground border-input font-mono">{template.ndpaRef}</Badge>
                        <span className="text-muted-foreground text-xs">{template.pages} pages</span>
                      </div>
                    </div>
                  </div>
                </div>

                <p className="text-muted-foreground text-xs leading-relaxed flex-1">{template.description}</p>

                <div className="flex flex-wrap gap-1">
                  {template.tags.map(tag => (
                    <span key={tag} className={`text-xs px-2 py-0.5 rounded-full font-medium ${tag === "mandatory" ? "bg-rose-500/20 text-rose-400" : "bg-muted/60 text-muted-foreground"}`}>
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex gap-2 pt-1 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-input text-foreground text-xs h-8"
                    onClick={() => setPreviewTemplate(template)}
                  >
                    <BookOpen className="w-3 h-3 mr-1.5" /> Preview
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
                    onClick={() => handleDownload(template)}
                  >
                    <Download className="w-3 h-3 mr-1.5" /> Download
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-cyan-700 text-primary text-xs h-8 mt-0.5"
                    onClick={() => { setAssignTemplate(template); setAssignClientId(""); setAssignNotes(""); }}
                  >
                    <UserPlus className="w-3 h-3 mr-1.5" /> Assign to Client
                  </Button>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 text-center py-16 text-muted-foreground">
              No templates match your search. Try a different keyword or category.
            </div>
          )}
        </div>
      )}

      {/* Assign to Client Dialog */}
      <Dialog open={!!assignTemplate} onOpenChange={open => { if (!open) setAssignTemplate(null); }}>
        <DialogContent className="bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-primary">Assign Policy Template to Client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-muted-foreground text-sm">Template</Label>
              <div className="mt-1 text-foreground font-medium">{assignTemplate?.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{assignTemplate?.ndpaRef}</div>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Client *</Label>
              <Select value={assignClientId} onValueChange={setAssignClientId}>
                <SelectTrigger className="mt-1 bg-card border-input text-foreground">
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-input">
                  {((clientsQuery.data as any)?.clients ?? []).map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)} className="text-foreground">{c.org_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-muted-foreground text-sm">Notes (optional)</Label>
              <Textarea
                value={assignNotes}
                onChange={e => setAssignNotes(e.target.value)}
                placeholder="Customisation instructions or delivery notes..."
                className="mt-1 bg-card border-input text-foreground placeholder:text-muted-foreground resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-input text-foreground" onClick={() => setAssignTemplate(null)}>Cancel</Button>
            <Button
              className="bg-primary hover:bg-primary/90 text-white"
              onClick={handleAssign}
              disabled={!assignClientId || assignMutation.isPending}
            >
              {assignMutation.isPending ? "Assigning..." : "Assign Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer note */}
      {!previewTemplate && (
        <div className="bg-muted/30 border border-border/50 rounded-lg p-4 flex items-start gap-3">
          <ExternalLink className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-muted-foreground text-xs leading-relaxed">
            These templates are based on the Nigeria Data Protection Act 2023 (NDPA) and Nigeria Data Protection Regulation 2019 (NDPR).
            They are provided as starting points and should be reviewed by qualified legal counsel before use.
            For official NDPC guidance, visit <span className="text-primary">ndpc.gov.ng</span>.
          </p>
        </div>
      )}
    </div>
  );
}
