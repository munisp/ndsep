-- Compliance Calendar Events Seed Data
INSERT INTO compliance_calendar_events (title, description, event_type, priority, event_date, sector, status, recurrence, reminder_days) VALUES
('NDPC Annual Compliance Report Submission', 'Annual data protection compliance report due to NDPC per NDPA 2023 Section 44', 'reporting', 'critical', NOW() + INTERVAL '15 days', 'all', 'upcoming', 'annually', 14),
('CBN Cybersecurity Framework Review', 'Quarterly review of cybersecurity controls per CBN Cybersecurity Framework 2023', 'audit', 'warning', NOW() + INTERVAL '22 days', 'banking', 'upcoming', 'quarterly', 7),
('NCC Data Protection Audit', 'Annual data protection audit for telecom operators per NCC Consumer Code', 'audit', 'critical', NOW() + INTERVAL '30 days', 'telecom', 'upcoming', 'annually', 14),
('NHIA Healthcare Data Compliance Review', 'Semi-annual review of patient data handling per NHIA Act 2022', 'audit', 'warning', NOW() + INTERVAL '45 days', 'healthcare', 'upcoming', 'quarterly', 7),
('NERC Energy Sector Data Report', 'Quarterly data sovereignty report for energy sector entities', 'reporting', 'info', NOW() + INTERVAL '60 days', 'energy', 'upcoming', 'quarterly', 7),
('DPO Certification Renewal Deadline', 'Batch renewal of DPO certifications expiring this quarter', 'renewal', 'warning', NOW() + INTERVAL '35 days', 'all', 'upcoming', 'none', 14),
('NDPA Staff Training Completion', 'Annual NDPA 2023 awareness training for all staff — completion deadline', 'training', 'info', NOW() + INTERVAL '50 days', 'all', 'upcoming', 'annually', 7),
('NAICOM Insurance Data Audit', 'Annual data protection audit for insurance companies per NAICOM guidelines', 'audit', 'warning', NOW() + INTERVAL '75 days', 'insurance', 'upcoming', 'annually', 14),
('Cross-Border Transfer Register Update', 'Quarterly update of cross-border data transfer register per NDPA Article 43', 'reporting', 'warning', NOW() + INTERVAL '20 days', 'all', 'upcoming', 'quarterly', 7),
('Breach Notification SLA Review', 'Monthly review of 72-hour breach notification compliance rate', 'audit', 'info', NOW() + INTERVAL '7 days', 'all', 'upcoming', 'monthly', 3),
('FCCPC Digital Competition Compliance', 'Annual compliance review for digital market competition rules', 'reporting', 'info', NOW() + INTERVAL '90 days', 'fintech', 'upcoming', 'annually', 14),
('ROPA Records Annual Update', 'Annual update of Records of Processing Activities per NDPA Schedule 2', 'reporting', 'warning', NOW() + INTERVAL '40 days', 'all', 'upcoming', 'annually', 7),
('Consent Management Audit', 'Quarterly audit of consent records and withdrawal mechanisms', 'audit', 'info', NOW() + INTERVAL '28 days', 'all', 'upcoming', 'quarterly', 7),
('Data Retention Policy Enforcement', 'Quarterly enforcement of data retention schedules — purge overdue records', 'deadline', 'warning', NOW() + INTERVAL '18 days', 'all', 'upcoming', 'quarterly', 5),
('NDPC Registration Renewal', 'Annual renewal of NDPC data controller registration', 'renewal', 'critical', NOW() + INTERVAL '10 days', 'all', 'upcoming', 'annually', 14)
ON CONFLICT DO NOTHING;
