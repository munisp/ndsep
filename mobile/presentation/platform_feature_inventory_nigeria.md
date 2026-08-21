# IDLR-PTS Platform Feature Inventory for Nigeria

The current deck **does not yet cover the full platform**. It shows part of the permitting, audit, and dashboard story, but it still underrepresents major capabilities in **geospatial intelligence, AI-assisted casework, field operations, extractives workflows, chain-of-custody governance, offline continuity, and multi-stakeholder delivery**.

In the Nigerian context, the platform should be understood not as a narrow permit app, but as a **national and state operating system for land administration, approvals, compliance, field validation, evidence integrity, and trusted market participation**. Its strongest story is that it can connect **federal oversight, state execution, builder delivery, civic accountability, and buyer confidence** on one shared workflow backbone.

## Nigeria-tailored view of what the platform does

| Platform layer | What it does in practice for Nigeria |
|---|---|
| **Land and parcel intelligence** | Links permits, approvals, inspections, and evidence to parcel and location context so states and regulators can make decisions with better land certainty. |
| **Permit and approval orchestration** | Runs structured approvals across mining, oil and gas, land, planning, environment, and multi-agency workflows with tracked stages, owners, and deadlines. |
| **Field and inspection operations** | Supports field teams with notifications, offline continuity, geofence-triggered alerts, secure local cache, and low-connectivity workflows. |
| **AI-assisted document and case handling** | Extracts data from uploaded files, summarizes notifications, ranks urgency, and helps users verify extracted content against source documents. |
| **Audit, verification, and trust controls** | Produces signed audit packages, verification flows, chain-of-custody records, key rotation, revocation tracking, and tamper-evident history. |
| **Leadership and public-value dashboards** | Gives federal and state leadership live views into queues, reminders, supervisor exceptions, bottlenecks, overdue handoffs, and workflow health. |

## Full feature map

### 1. Land, parcel, and geospatial features

The current deck barely touches this layer, but it is one of the platform’s most strategic capabilities for Nigeria. The platform is not only about approvals; it is about **approvals tied to place**.

| Capability | Nigeria relevance |
|---|---|
| Parcel-linked case records | Keeps land, title, permit, and compliance records connected. |
| Location labels and asset references | Helps agencies work with recognizable Nigerian administrative and project references. |
| Spatial-clearance stage in workflow | Formalizes geospatial review rather than treating it as an informal side step. |
| Geofence-based subscription alerts | Supports location-aware notifications for parcel-sensitive cases and field operations. |
| Offline geofence replay and reconciliation | Preserves field events when connectivity fails and reconciles them when service returns. |
| Map and location-oriented workflow design | Makes the platform suitable for land administration, mining titles, corridor approvals, and facility siting. |

For Nigeria, this matters because land administration, planning, extractives licensing, and rights-of-way are fundamentally **geospatial problems**, not just paperwork problems.

### 2. Core permitting and workflow engine

This is the heart of the system and is broader than the current deck suggests.

| Capability | Description |
|---|---|
| Multi-stage permit lifecycle | Supports intake, spatial clearance, technical review, environmental review, agency coordination, payment, approval, issuance, and active monitoring. |
| Multi-sector support | Covers mining, oil and gas, land-related approvals, and general multi-agency permitting. |
| Sector-specific permit forms | Includes mining and petroleum form sections tailored to operational and compliance realities. |
| Editable intake and review forms | Allows structured form editing through the lifecycle of a case. |
| Role-sensitive case progression | Different actors see different controls depending on their role. |
| Active monitoring stage | Extends beyond issuance into obligations and ongoing compliance. |
| Deadline-aware workflow | Handoffs, due dates, and escalations are tracked explicitly. |

### 3. Multi-agency coordination and approval governance

This is one of the most important Nigerian value propositions because many public-sector delays happen at agency boundaries.

| Capability | Description |
|---|---|
| Participating-agency model | A case can involve multiple agencies, not just a single owner. |
| Approval queues by agency and role | Work is organized by operational responsibility. |
| Timed approval handoffs | Cases move with explicit due dates between reviewers and supervisors. |
| Escalation timers | Near-due and overdue handoffs are surfaced before service failure becomes invisible. |
| Supervisor override and reassignment | Exceptions can be handled without breaking accountability. |
| Automated reviewer assignment | Escalated cases can be automatically assigned using rules. |
| Multi-step approval handoff rules | Complex agency sequences can be formalized instead of improvised. |
| Digest summaries for supervisors | Backlogs and overdue cases are summarized in-platform for management attention. |

### 4. Dashboard, queue, and operational analytics

The deck currently shows dashboards, but it still underplays how deep the analytics layer has become.

| Capability | Description |
|---|---|
| Live dashboard cards | Home and permit dashboards reflect seeded live counts rather than static placeholders. |
| Stakeholder-tailored dashboard views | Federal, state, and builder views highlight different KPIs. |
| Agency queue filters | Users can isolate queue conditions by agency and role. |
| SLA dashboard | Tracks pending work, overdue cases, and average response times. |
| Visual urgency indicators | Cases approaching deadlines are highlighted visually. |
| Interactive queue analytics | Charts show patterns in queue stress and workflow bottlenecks. |
| Supervisor exception dashboard | Shows escalation trends and reassignment patterns with interactive analytics. |
| Reminder-driven dashboard signals | Scheduled reminders feed visible urgency states, not just background notifications. |

### 5. Notifications, reminders, and operational communications

This area is more mature than the deck implies and is highly relevant to Nigerian public workflows where follow-through is often the real bottleneck.

| Capability | Description |
|---|---|
| In-app notification center | Central feed for alerts, handoff reminders, and reviewer actions. |
| AI-ranked notifications | Alerts can be prioritized based on interaction history and context. |
| AI summaries of notification content | Reduces cognitive load for reviewers and supervisors. |
| Parcel-level notification controls | Users can mute or tailor parcel-specific notifications. |
| Server-synced notification preferences | Preferences persist across active devices. |
| Handoff deadline alerts | Reviewers and supervisors receive reminders before escalation. |
| Scheduled digest notifications | Summaries of backlogs and overdue handoffs are generated for supervisors. |
| Background reminder scheduling | Alerts are prepared around upcoming handoff thresholds. |

### 6. AI and document intelligence

This is one of the biggest gaps in the current deck. The platform is not merely digitized workflow; it also includes **AI-assisted operational intelligence**.

| Capability | Description |
|---|---|
| Document extraction from uploaded files | Uploaded permit documents can be parsed to populate intake forms. |
| PDF and image parsing | Supports true uploaded file parsing rather than placeholder text-only flows. |
| Side-by-side verification | Users can compare extracted values against the original uploaded document. |
| Field-level extraction provenance | Form fields can retain manual-versus-AI source status. |
| AI prefill for permit forms | Reduces rekeying and speeds intake preparation. |
| AI notification summarization | Converts long alerts into faster-read summaries. |
| AI-based priority ranking | Surfaces high-value or high-risk alerts using interaction history. |
| Heuristic fallback for model unavailability | Keeps workflows usable when no external model is reachable. |

### 7. Audit, evidence integrity, and verification

This is another area that should be much more prominent in a stakeholder deck because it is a major trust differentiator.

| Capability | Description |
|---|---|
| Exportable audit histories | Records can be exported for review and recordkeeping. |
| CSV and PDF audit downloads | Audit files can be downloaded directly to device storage. |
| Signed audit-package generation | Exported audit logs carry tamper-evident metadata. |
| SHA-256 package hashing | Supports integrity checking of exported audit content. |
| Public-key verification | External parties can validate shared audit packages on-platform. |
| Dedicated audit verification page | Users can upload packages and validate signatures directly. |
| Signing-key registry | Signing keys are tracked as managed platform records. |
| Key rotation and revocation tracking | Supports long-term verification hygiene and key lifecycle governance. |
| Verifier metadata in packages | Audit exports include the information needed for verification. |

### 8. Chain of custody and evidence governance

This is especially important for Nigeria where regulatory disputes, community concerns, and enforcement actions often depend on confidence in evidence handling.

| Capability | Description |
|---|---|
| Custody timeline for audit packages | Tracks who generated, downloaded, uploaded, verified, or reassigned a package. |
| Custody timeline for evidence packages | Extends governance beyond audit logs into the evidence layer. |
| Visual chain-of-custody timeline | Surfaces custody history clearly in the permit workflow. |
| Tamper-evident evidence governance | Helps regulators defend the credibility of records and decisions. |
| Audit recording of supervisor actions | Overrides and reassignments remain visible. |

### 9. Field operations and low-connectivity resilience

This is a major Africa-fit strength and should be emphasized far more heavily in the deck.

| Capability | Description |
|---|---|
| Offline audit-package caching | Audit materials can be carried into low-connectivity environments. |
| Encrypted local cache | Sensitive material is stored securely on device. |
| Biometric unlock | Inspectors must re-authenticate to access protected local materials. |
| Offline audit access management | Cached packages can be managed directly from the permit workflow. |
| Offline replay queue | Critical field events persist locally until connectivity returns. |
| Conflict reconciliation | Delayed or duplicate geofence transitions are reconciled safely. |
| Geofence-triggered operational alerts | Location events can become workflow-relevant notifications. |

### 10. Security, authorization, and role controls

| Capability | Description |
|---|---|
| Portable local JWT authentication | Platform can run outside Manus using portable auth. |
| Role-based visibility and edit controls | Applicants, reviewers, and supervisors see different controls. |
| Agency-user session switching | Supports realistic operational identity contexts. |
| Supervisor-only reassignment actions | Restricts exception handling to the right authority level. |
| Secure offline session patterns | Sensitive local content is tied to stronger local access controls. |

### 11. Nigeria-specific sector support

The platform is already positioned around sectors that matter materially to Nigeria’s economy and state capacity.

| Sector | Supported platform direction |
|---|---|
| Housing and urban delivery | Land workflows, permit approvals, title-adjacent operations, buyer trust, and state revenue. |
| Mining | Cadastre-linked licensing, technical review, environmental review, obligations, and transparent workflow. |
| Oil and gas | Licensing, HSE controls, review workflow, abandonment-security handling, and multi-agency coordination. |
| Multi-agency public approvals | Planning, environment, infrastructure, and oversight coordination on one record. |

### 12. Platform architecture and deployment completeness

This also matters because it means the platform is not just a mockup.

| Capability | Description |
|---|---|
| Native mobile and PWA parity | Major workflows are available across both surfaces. |
| TypeScript, Go, Python, and Rust topology | The platform includes a polyglot service scaffold for growth. |
| Middleware contracts | Shared service contracts for workflow, events, analytics, and policy. |
| Portable storage and self-hosting path | Refactored away from Manus-only runtime dependencies. |
| OpenAI-compatible provider abstraction | AI services can run against portable endpoints such as Ollama-compatible APIs. |
| Self-hosting documentation and compose stack | Deployment path exists beyond the sandbox environment. |

## What the current deck is still missing

The deck you reviewed is **not wrong**, but it is **incomplete**. It currently emphasizes executive dashboards, permit workflow, audit verification, and broad stakeholder value. It still underrepresents the features below.

| Underrepresented area | Why it should be added |
|---|---|
| **Geospatial and parcel intelligence** | This is foundational to land, mining, infrastructure, and planning decisions in Nigeria. |
| **AI-assisted extraction and prioritization** | This is a major differentiator and should be shown more explicitly. |
| **Field operations and offline resilience** | This is one of the clearest Africa-fit strengths of the platform. |
| **Multi-agency escalation controls** | The approval-handoff model is a major public-sector value proposition. |
| **Chain-of-custody and tamper-evidence** | This is critical for trust, disputes, enforcement, and investor confidence. |
| **Extractives-specific workflows** | Mining and oil-and-gas support should be much more visible for Nigeria. |
| **Supervisor analytics and workload governance** | Important for real institutional management, not just front-end workflow. |
| **Stakeholder-specific views** | Federal, state, builder, NGO, and buyer lenses should each have dedicated slides. |

## What the revised Nigeria-focused deck should add

A fuller Nigeria-tailored deck should add separate slides for **geospatial and land intelligence**, **AI and document extraction**, **field inspection and offline continuity**, **mining and oil-and-gas workflows**, **trust and chain-of-custody controls**, and **stakeholder-tailored value by audience**. Without those, the platform still looks smaller than it actually is.

## Bottom line

If presented properly, the platform is not just a permit dashboard. It is a **Nigeria-ready operating system for land, approvals, evidence, field validation, public accountability, and trusted market participation**. That broader story is what should anchor the next version of the stakeholder deck.
