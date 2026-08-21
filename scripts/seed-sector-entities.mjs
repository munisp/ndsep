/**
 * Seed Sector Entities - NDSEP Platform
 * Seeds: fintech_companies, energy_companies, insurance_companies, telecom_operators
 * Usage: node scripts/seed-sector-entities.mjs
 */
import pg from "pg";
import { config } from "dotenv";
config();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function q(sql, params = []) {
  const client = await pool.connect();
  try { const res = await client.query(sql, params); return res.rows; } finally { client.release(); }
}
async function getColumns(table) {
  const rows = await q("SELECT column_name FROM information_schema.columns WHERE table_name = $1", [table]);
  return rows.map(r => r.column_name);
}
async function tableExists(table) {
  const rows = await q("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1) AS exists", [table]);
  return rows[0]?.exists === true;
}
async function seedFintechCompanies() {
  console.log("Seeding fintech_companies...");
  if (!(await tableExists("fintech_companies"))) { console.log("  table not found, skipping."); return; }
  const cnt = await q("SELECT COUNT(*) as cnt FROM fintech_companies");
  if (parseInt(cnt[0]?.cnt ?? "0") >= 5) { console.log(`  already has ${cnt[0].cnt} rows, skipping.`); return; }
  const companies = [
    { name: "Flutterwave", rc_number: "RC1234567", licence_type: "payment_service_provider", cbn_licence_number: "CBN/PSP/001/2019", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: true, ndpc_registered: true, goaml_registered: true, status: "active" },
    { name: "Paystack", rc_number: "RC2345678", licence_type: "payment_service_provider", cbn_licence_number: "CBN/PSP/002/2016", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: true, ndpc_registered: true, goaml_registered: true, status: "active" },
    { name: "Opay", rc_number: "RC3456789", licence_type: "mobile_money_operator", cbn_licence_number: "CBN/MMO/003/2018", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: false, ndpc_registered: true, goaml_registered: true, status: "active" },
    { name: "Kuda Bank", rc_number: "RC4567890", licence_type: "microfinance_bank", cbn_licence_number: "CBN/MFB/004/2019", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: true, ndpc_registered: true, goaml_registered: true, status: "active" },
    { name: "PiggyVest", rc_number: "RC5678901", licence_type: "investment_platform", cbn_licence_number: null, headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: false, ndpc_registered: false, goaml_registered: false, status: "active" },
    { name: "Cowrywise", rc_number: "RC6789012", licence_type: "investment_platform", cbn_licence_number: null, headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: false, ndpc_registered: true, goaml_registered: false, status: "active" },
    { name: "Interswitch", rc_number: "RC7890123", licence_type: "payment_service_provider", cbn_licence_number: "CBN/PSP/007/2002", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: true, ndpc_registered: true, goaml_registered: true, status: "active" },
    { name: "Remita", rc_number: "RC8901234", licence_type: "payment_service_provider", cbn_licence_number: "CBN/PSP/008/2005", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: true, ndpc_registered: true, goaml_registered: true, status: "active" },
    { name: "Carbon (Paylater)", rc_number: "RC9012345", licence_type: "digital_lending", cbn_licence_number: "CBN/DL/009/2016", headquarters: "Lagos", data_localisation_compliant: false, pci_dss_compliant: false, ndpc_registered: false, goaml_registered: true, status: "active" },
    { name: "TeamApt (Moniepoint)", rc_number: "RC0123456", licence_type: "payment_service_provider", cbn_licence_number: "CBN/PSP/010/2015", headquarters: "Lagos", data_localisation_compliant: true, pci_dss_compliant: true, ndpc_registered: true, goaml_registered: true, status: "active" },
  ];
  const cols = await getColumns("fintech_companies");
  for (const c of companies) {
    try {
      const ic = ["name","rc_number","licence_type","headquarters","status"]; const iv = [c.name,c.rc_number,c.licence_type,c.headquarters,c.status];
      if(cols.includes("cbn_licence_number")){ic.push("cbn_licence_number");iv.push(c.cbn_licence_number);}
      if(cols.includes("data_localisation_compliant")){ic.push("data_localisation_compliant");iv.push(c.data_localisation_compliant);}
      if(cols.includes("pci_dss_compliant")){ic.push("pci_dss_compliant");iv.push(c.pci_dss_compliant);}
      if(cols.includes("ndpc_registered")){ic.push("ndpc_registered");iv.push(c.ndpc_registered);}
      if(cols.includes("goaml_registered")){ic.push("goaml_registered");iv.push(c.goaml_registered);}
      const ph = iv.map((_,i)=>`$${i+1}`);
      await q(`INSERT INTO fintech_companies (${ic.join(",")},created_at) VALUES (${ph.join(",")},NOW()) ON CONFLICT (rc_number) DO NOTHING`, iv);
    } catch(e){ console.log(`  Warning ${c.name}: ${e.message}`); }
  }
  console.log(`  Inserted ${companies.length} fintech companies.`);
}
async function seedEnergyCompanies() {
  console.log("Seeding energy_companies...");
  if (!(await tableExists("energy_companies"))) { console.log("  table not found, skipping."); return; }
  const cnt = await q("SELECT COUNT(*) as cnt FROM energy_companies");
  if (parseInt(cnt[0]?.cnt ?? "0") >= 5) { console.log(`  already has ${cnt[0].cnt} rows, skipping.`); return; }
  const companies = [
    { name: "EKEDC (Eko Electricity)", rc_number: "RC-EKEDC-001", licence_type: "distribution", nerc_licence_number: "NERC/DL/001/2013", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "IKEDC (Ikeja Electric)", rc_number: "RC-IKEDC-002", licence_type: "distribution", nerc_licence_number: "NERC/DL/002/2013", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "AEDC (Abuja Electricity)", rc_number: "RC-AEDC-003", licence_type: "distribution", nerc_licence_number: "NERC/DL/003/2013", headquarters: "Abuja", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "PHED (Port Harcourt Electricity)", rc_number: "RC-PHED-004", licence_type: "distribution", nerc_licence_number: "NERC/DL/004/2013", headquarters: "Port Harcourt", data_localisation_compliant: false, ndpc_registered: false, status: "active" },
    { name: "Transcorp Power", rc_number: "RC-TRCP-005", licence_type: "generation", nerc_licence_number: "NERC/GL/005/2013", headquarters: "Abuja", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "Azura Power", rc_number: "RC-AZUR-006", licence_type: "generation", nerc_licence_number: "NERC/GL/006/2015", headquarters: "Benin City", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "NNPC Gas and Power", rc_number: "RC-NNPC-007", licence_type: "transmission", nerc_licence_number: "NERC/TL/007/2010", headquarters: "Abuja", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "Seplat Energy", rc_number: "RC-SEPL-008", licence_type: "upstream", nerc_licence_number: null, headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
  ];
  const cols = await getColumns("energy_companies");
  for (const c of companies) {
    try {
      const ic = ["name","rc_number","licence_type","headquarters","status"]; const iv = [c.name,c.rc_number,c.licence_type,c.headquarters,c.status];
      if(cols.includes("nerc_licence_number")){ic.push("nerc_licence_number");iv.push(c.nerc_licence_number);}
      if(cols.includes("data_localisation_compliant")){ic.push("data_localisation_compliant");iv.push(c.data_localisation_compliant);}
      if(cols.includes("ndpc_registered")){ic.push("ndpc_registered");iv.push(c.ndpc_registered);}
      const ph = iv.map((_,i)=>`$${i+1}`);
      await q(`INSERT INTO energy_companies (${ic.join(",")},created_at) VALUES (${ph.join(",")},NOW()) ON CONFLICT (rc_number) DO NOTHING`, iv);
    } catch(e){ console.log(`  Warning ${c.name}: ${e.message}`); }
  }
  console.log(`  Inserted ${companies.length} energy companies.`);
}
async function seedInsuranceCompanies() {
  console.log("Seeding insurance_companies...");
  if (!(await tableExists("insurance_companies"))) { console.log("  table not found, skipping."); return; }
  const cnt = await q("SELECT COUNT(*) as cnt FROM insurance_companies");
  if (parseInt(cnt[0]?.cnt ?? "0") >= 4) { console.log(`  already has ${cnt[0].cnt} rows, skipping.`); return; }
  const companies = [
    { name: "AIICO Insurance", rc_number: "RC-AIICO-001", licence_type: "composite", naicom_licence_number: "NAICOM/CL/001/1963", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "Leadway Assurance", rc_number: "RC-LEAD-002", licence_type: "composite", naicom_licence_number: "NAICOM/CL/002/1970", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "AXA Mansard", rc_number: "RC-AXAM-003", licence_type: "composite", naicom_licence_number: "NAICOM/CL/003/1989", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "Cornerstone Insurance", rc_number: "RC-CORN-004", licence_type: "life", naicom_licence_number: "NAICOM/LL/004/1991", headquarters: "Lagos", data_localisation_compliant: false, ndpc_registered: false, status: "active" },
    { name: "Custodian Investment", rc_number: "RC-CUST-005", licence_type: "composite", naicom_licence_number: "NAICOM/CL/005/1991", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { name: "NEM Insurance", rc_number: "RC-NEMI-006", licence_type: "general", naicom_licence_number: "NAICOM/GL/006/1970", headquarters: "Lagos", data_localisation_compliant: true, ndpc_registered: false, status: "active" },
  ];
  const cols = await getColumns("insurance_companies");
  for (const c of companies) {
    try {
      const ic = ["name","rc_number","licence_type","headquarters","status"]; const iv = [c.name,c.rc_number,c.licence_type,c.headquarters,c.status];
      if(cols.includes("naicom_licence_number")){ic.push("naicom_licence_number");iv.push(c.naicom_licence_number);}
      if(cols.includes("data_localisation_compliant")){ic.push("data_localisation_compliant");iv.push(c.data_localisation_compliant);}
      if(cols.includes("ndpc_registered")){ic.push("ndpc_registered");iv.push(c.ndpc_registered);}
      const ph = iv.map((_,i)=>`$${i+1}`);
      await q(`INSERT INTO insurance_companies (${ic.join(",")},created_at) VALUES (${ph.join(",")},NOW()) ON CONFLICT (rc_number) DO NOTHING`, iv);
    } catch(e){ console.log(`  Warning ${c.name}: ${e.message}`); }
  }
  console.log(`  Inserted ${companies.length} insurance companies.`);
}
async function seedTelecomOperators() {
  console.log("Seeding telecom_operators...");
  if (!(await tableExists("telecom_operators"))) { console.log("  table not found, skipping."); return; }
  const cnt = await q("SELECT COUNT(*) as cnt FROM telecom_operators");
  if (parseInt(cnt[0]?.cnt ?? "0") >= 4) { console.log(`  already has ${cnt[0].cnt} rows, skipping.`); return; }
  const operators = [
    { operator_name: "MTN Nigeria", operator_code: "MTN", operator_type: "mobile_network_operator", ncc_licence_number: "NCC/MNO/001/2001", headquarters: "Lagos", subscriber_base: 76000000, nin_sim_linkage_compliant: true, cdr_retention_compliant: true, data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { operator_name: "Airtel Nigeria", operator_code: "AIRTEL", operator_type: "mobile_network_operator", ncc_licence_number: "NCC/MNO/002/2001", headquarters: "Lagos", subscriber_base: 55000000, nin_sim_linkage_compliant: true, cdr_retention_compliant: true, data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { operator_name: "Glo Mobile", operator_code: "GLO", operator_type: "mobile_network_operator", ncc_licence_number: "NCC/MNO/003/2003", headquarters: "Lagos", subscriber_base: 52000000, nin_sim_linkage_compliant: true, cdr_retention_compliant: false, data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { operator_name: "9mobile (Etisalat)", operator_code: "9MOBILE", operator_type: "mobile_network_operator", ncc_licence_number: "NCC/MNO/004/2008", headquarters: "Lagos", subscriber_base: 13000000, nin_sim_linkage_compliant: true, cdr_retention_compliant: true, data_localisation_compliant: false, ndpc_registered: false, status: "active" },
    { operator_name: "Ntel", operator_code: "NTEL", operator_type: "mobile_network_operator", ncc_licence_number: "NCC/MNO/005/2016", headquarters: "Lagos", subscriber_base: 500000, nin_sim_linkage_compliant: true, cdr_retention_compliant: true, data_localisation_compliant: true, ndpc_registered: true, status: "active" },
    { operator_name: "Smile Communications", operator_code: "SMILE", operator_type: "internet_service_provider", ncc_licence_number: "NCC/ISP/006/2007", headquarters: "Lagos", subscriber_base: 2000000, nin_sim_linkage_compliant: false, cdr_retention_compliant: true, data_localisation_compliant: true, ndpc_registered: true, status: "active" },
  ];
  const cols = await getColumns("telecom_operators");
  for (const op of operators) {
    try {
      const ic = ["operator_name","operator_code","operator_type","headquarters","status"]; const iv = [op.operator_name,op.operator_code,op.operator_type,op.headquarters,op.status];
      if(cols.includes("ncc_licence_number")){ic.push("ncc_licence_number");iv.push(op.ncc_licence_number);}
      if(cols.includes("subscriber_base")){ic.push("subscriber_base");iv.push(op.subscriber_base);}
      if(cols.includes("nin_sim_linkage_compliant")){ic.push("nin_sim_linkage_compliant");iv.push(op.nin_sim_linkage_compliant);}
      if(cols.includes("cdr_retention_compliant")){ic.push("cdr_retention_compliant");iv.push(op.cdr_retention_compliant);}
      if(cols.includes("data_localisation_compliant")){ic.push("data_localisation_compliant");iv.push(op.data_localisation_compliant);}
      if(cols.includes("ndpc_registered")){ic.push("ndpc_registered");iv.push(op.ndpc_registered);}
      const ph = iv.map((_,i)=>`$${i+1}`);
      const cc = cols.includes("operator_code") ? "operator_code" : "operator_name";
      await q(`INSERT INTO telecom_operators (${ic.join(",")},created_at) VALUES (${ph.join(",")},NOW()) ON CONFLICT (${cc}) DO NOTHING`, iv);
    } catch(e){ console.log(`  Warning ${op.operator_name}: ${e.message}`); }
  }
  console.log(`  Inserted ${operators.length} telecom operators.`);
}
async function main() {
  console.log("=== NDSEP Sector Entity Seed ===");
  try {
    await seedFintechCompanies();
    await seedEnergyCompanies();
    await seedInsuranceCompanies();
    await seedTelecomOperators();
    console.log("\n✅ Sector entity seed complete.");
  } catch(err) { console.error("Seed failed:", err); process.exit(1); }
  finally { await pool.end(); }
}
main();
