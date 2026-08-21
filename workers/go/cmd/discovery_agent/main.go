// NDSEP Layer 1 — Discovery Agent Heartbeat Worker (Go)
// =======================================================
// Simulates NMAP, Censys, CloudQuery, GLPI, and Nessus agent check-ins.
// Performs:
//   - Active and passive asset scanning with OS/service fingerprinting
//   - Hardware/software/cloud/network asset identification
//   - CVE vulnerability assessment (NVD/MITRE database simulation)
//   - Asset geolocation tagging (lat/lon within Nigeria/Africa)
//   - Agent health monitoring and status updates
//   - New asset discovery events with full metadata
//
// Writes to assets table in PostgreSQL.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"ndsep/workers/shared"
)

var (
	eventsProcessed  int64
	assetsDiscovered int64
	cvesDetected     int64
	workerStart      = time.Now()
)

// Nigerian/African datacenter locations with lat/lon
var locations = []struct {
	name string
	lat  float64
	lon  float64
}{
	{"Lagos-DC1", 6.5244, 3.3792},
	{"Abuja-DC2", 9.0765, 7.3986},
	{"PortHarcourt-DC3", 4.8156, 7.0498},
	{"Kano-Edge1", 12.0022, 8.5920},
	{"Ibadan-Edge2", 7.3775, 3.9470},
	{"Nairobi-DC1", -1.2921, 36.8219},
	{"Johannesburg-DC1", -26.2041, 28.0473},
	{"Cairo-DC1", 30.0444, 31.2357},
}

var operatingSystems = []string{
	"Ubuntu 22.04 LTS", "Ubuntu 20.04 LTS", "CentOS 7", "RHEL 8",
	"Windows Server 2022", "Windows Server 2019", "Debian 11",
	"FreeBSD 13", "Alpine Linux 3.18", "Amazon Linux 2",
}

var cloudProviders = []string{"AWS", "Azure", "GCP", "OCI", "Alibaba", "Local"}
var cloudRegions = []string{"af-south-1", "westeurope", "us-east-1", "me-central-1", "ap-southeast-1"}

// CVE database simulation
var cveDatabase = []struct {
	id       string
	severity string
	cvss     float64
	desc     string
}{
	{"CVE-2024-3094", "critical", 10.0, "XZ Utils backdoor in liblzma"},
	{"CVE-2024-21762", "critical", 9.6, "Fortinet FortiOS out-of-bound write"},
	{"CVE-2023-44487", "high", 7.5, "HTTP/2 Rapid Reset Attack (DDoS)"},
	{"CVE-2023-4966", "critical", 9.4, "Citrix Bleed - session token leak"},
	{"CVE-2023-46604", "critical", 10.0, "Apache ActiveMQ RCE"},
	{"CVE-2023-20198", "critical", 10.0, "Cisco IOS XE privilege escalation"},
	{"CVE-2024-1709", "critical", 10.0, "ConnectWise ScreenConnect auth bypass"},
	{"CVE-2024-6387", "high", 8.1, "OpenSSH regreSSHion race condition"},
	{"CVE-2023-42793", "critical", 9.8, "JetBrains TeamCity auth bypass"},
	{"CVE-2024-23897", "critical", 9.8, "Jenkins arbitrary file read"},
	{"CVE-2024-27198", "critical", 9.8, "JetBrains TeamCity auth bypass 2"},
	{"CVE-2023-34048", "critical", 9.8, "VMware vCenter RCE"},
	{"CVE-2024-21887", "critical", 9.1, "Ivanti Connect Secure command injection"},
	{"CVE-2023-22527", "critical", 10.0, "Atlassian Confluence SSTI RCE"},
	{"CVE-2024-3400", "critical", 10.0, "PAN-OS GlobalProtect command injection"},
}

var assetTypes = []string{"hardware", "software", "cloud", "network", "database", "saas"}
var assetStatuses = []string{"active", "active", "active", "inactive", "quarantined"}
var scanTools = []string{"nmap", "censys", "cloudquery", "glpi", "nessus"}
var classificationLevels = []string{"tier1_pii", "tier2_financial", "tier3_health", "tier4_government", "tier5_public"}
var agentStatuses = []string{"active", "active", "active", "active", "inactive", "error"}

// runAssetScanWorker simulates discovery agents scanning for assets with fingerprinting
func runAssetScanWorker() {
	log.Println("[Discovery] Starting asset scan worker (NMAP/Censys/CloudQuery/GLPI/Nessus)...")
	ticker := time.NewTicker(8 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		orgIDs, orgNames, err := shared.GetOrgIDs()
		if err != nil || len(orgIDs) == 0 {
			continue
		}

		idx := rand.Intn(len(orgIDs))
		orgID := orgIDs[idx]
		orgName := orgNames[idx]
		tool := shared.RandomChoice(scanTools)
		assetType := shared.RandomChoice(assetTypes)

		if rand.Float64() < 0.35 {
			assetName := fmt.Sprintf("%s-%s-%04d", assetType, tool, shared.RandomBetween(1000, 9999))
			classification := shared.RandomChoice(classificationLevels)
			status := shared.RandomChoice(assetStatuses)
			locIdx := rand.Intn(len(locations))
			loc := locations[locIdx]
			os := shared.RandomChoice(operatingSystems)
			osVer := fmt.Sprintf("%d.%d.%d", rand.Intn(5)+1, rand.Intn(20), rand.Intn(100))
			ip := fmt.Sprintf("10.%d.%d.%d", rand.Intn(255), rand.Intn(255), rand.Intn(254)+1)
			mac := fmt.Sprintf("%02X:%02X:%02X:%02X:%02X:%02X",
				rand.Intn(256), rand.Intn(256), rand.Intn(256),
				rand.Intn(256), rand.Intn(256), rand.Intn(256))
			hostname := fmt.Sprintf("%s-%s-%04d.ndsep.internal", assetType, loc.name, rand.Intn(9999))
			cloudProv := shared.RandomChoice(cloudProviders)
			cloudReg := shared.RandomChoice(cloudRegions)
			vulnCount := rand.Intn(25)
			isWithin := loc.lat >= -35 && loc.lat <= 37 && loc.lon >= -17 && loc.lon <= 51

			var assetID int
			err = shared.DB.QueryRow(`
				INSERT INTO assets
					(organization_id, name, asset_type, data_classification, status, location,
					 ip_address, mac_address, hostname, operating_system, os_version,
					 latitude, longitude, cloud_provider, cloud_region,
					 is_within_borders, vulnerability_count, discovered_at, last_seen, created_at)
				VALUES ($1, $2, $3::asset_type, $4::data_classification, $5::asset_status, $6,
					$7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW(), NOW())
				RETURNING id`,
				orgID, assetName, assetType, classification, status, loc.name,
				ip, mac, hostname, os, osVer,
				loc.lat, loc.lon, cloudProv, cloudReg,
				isWithin, vulnCount,
			).Scan(&assetID)

			if err == nil {
				atomic.AddInt64(&assetsDiscovered, 1)
				shared.Broadcast("new_asset_discovered", map[string]interface{}{
					"type":             "new_asset_discovered",
					"assetId":          assetID,
					"assetName":        assetName,
					"assetType":        assetType,
					"classification":   classification,
					"status":           status,
					"location":         loc.name,
					"latitude":         loc.lat,
					"longitude":        loc.lon,
					"ipAddress":        ip,
					"hostname":         hostname,
					"operatingSystem":  os,
					"cloudProvider":    cloudProv,
					"cloudRegion":      cloudReg,
					"isWithinBorders":  isWithin,
					"vulnerabilities":  vulnCount,
					"organizationId":   orgID,
					"organizationName": orgName,
					"scanTool":         tool,
					"timestamp":        time.Now().UTC().Format(time.RFC3339),
				})
				log.Printf("[Discovery] New asset: %s (%s) @ %s for %s via %s\n",
					assetName, assetType, loc.name, orgName, tool)
			}
		}

		// Always broadcast heartbeat
		atomic.AddInt64(&eventsProcessed, 1)
		shared.Broadcast("asset_heartbeat", map[string]interface{}{
			"type":             "asset_heartbeat",
			"organizationId":   orgID,
			"organizationName": orgName,
			"agentId":          fmt.Sprintf("agent-%s-%03d", tool, orgID),
			"scanTool":         tool,
			"status":           shared.RandomChoice([]string{"online", "online", "online", "degraded"}),
			"assetsScanned":    shared.RandomBetween(10, 500),
			"newAssetsFound":   shared.RandomBetween(0, 5),
			"vulnerabilities":  shared.RandomBetween(0, 20),
			"timestamp":        time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// runCVEScanner simulates Nessus/OpenVAS vulnerability scanning against discovered assets
func runCVEScanner() {
	log.Println("[Discovery] Starting CVE vulnerability scanner (Nessus/OpenVAS simulation)...")
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		var assetID int
		var assetName, orgName string
		var orgID int
		err := shared.DB.QueryRow(`
			SELECT a.id, a.name, a.organization_id, o.name
			FROM assets a
			JOIN organizations o ON o.id = a.organization_id
			ORDER BY RANDOM() LIMIT 1`).Scan(&assetID, &assetName, &orgID, &orgName)
		if err != nil {
			continue
		}
		numCVEs := rand.Intn(4)
		foundCVEs := make([]map[string]interface{}, 0, numCVEs)
		for i := 0; i < numCVEs; i++ {
			cve := cveDatabase[rand.Intn(len(cveDatabase))]
			atomic.AddInt64(&cvesDetected, 1)
			foundCVEs = append(foundCVEs, map[string]interface{}{
				"cveId":       cve.id,
				"severity":    cve.severity,
				"cvssScore":   cve.cvss,
				"description": cve.desc,
			})
			if cve.severity == "critical" {
				title := fmt.Sprintf("[CVE] %s on %s", cve.id, assetName)
				desc := fmt.Sprintf("Critical CVE %s (CVSS %.1f) detected on asset %s belonging to %s. %s",
					cve.id, cve.cvss, assetName, orgName, cve.desc)
				_, _ = shared.DB.Exec(`
					INSERT INTO security_alerts (organization_id, title, description, severity, source, alert_type, detected_at)
					VALUES ($1, $2, $3, 'critical'::severity, 'Nessus-CVE-Scanner', 'vulnerability', NOW())`,
					orgID, title, desc)
			}
		}
		if numCVEs > 0 {
			_, _ = shared.DB.Exec(`UPDATE assets SET vulnerability_count = vulnerability_count + $1, last_seen = NOW() WHERE id = $2`,
				numCVEs, assetID)
		}
		shared.Broadcast("cve_scan_complete", map[string]interface{}{
			"type":             "cve_scan_complete",
			"assetId":          assetID,
			"assetName":        assetName,
			"organizationId":   orgID,
			"organizationName": orgName,
			"cves":             foundCVEs,
			"scanTool":         "nessus",
			"totalCves":        numCVEs,
			"timestamp":        time.Now().UTC().Format(time.RFC3339),
		})
		if numCVEs > 0 {
			log.Printf("[Discovery] CVE scan: %s -> %d CVEs found\n", assetName, numCVEs)
		}
	}
}

// runAgentStatusUpdater broadcasts periodic agent status updates for all organizations
func runAgentStatusUpdater() {
	log.Println("[Discovery] Starting agent status broadcaster...")
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		orgIDs, orgNames, err := shared.GetOrgIDs()
		if err != nil || len(orgIDs) == 0 {
			continue
		}

		for i, orgID := range orgIDs {
			status := shared.RandomChoice(agentStatuses)
			shared.Broadcast("agent_status_update", map[string]interface{}{
				"type":             "agent_status_update",
				"organizationId":   orgID,
				"organizationName": orgNames[i],
				"agentId":          fmt.Sprintf("agent-%03d", orgID),
				"status":           status,
			"assetsCount":      shared.RandomBetween(10, 1000),
			"cvesDetected":     atomic.LoadInt64(&cvesDetected),
			"timestamp":        time.Now().UTC().Format(time.RFC3339),
			})
		}
		log.Printf("[Discovery] Broadcast agent status for %d organizations\n", len(orgIDs))
	}
}

func startStatusServer(port string) {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "worker": "discovery_agent"})
	})

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(shared.WorkerStatus{
			ID:              "discovery-agent",
			Name:            "Discovery Agent Heartbeat",
			Layer:           "L1",
			Language:        "Go",
			Status:          "running",
			LastRun:         time.Now(),
			EventsProcessed: atomic.LoadInt64(&eventsProcessed),
			Description:     "Polls NMAP, Censys, CloudQuery, GLPI, and Nessus agents for asset inventory updates. Performs OS/service fingerprinting, CVE scanning, and geolocation tagging.",
			Technology:      "Go · NMAP · Censys · CloudQuery · GLPI · Nessus · NVD",
		})
	})

	http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"eventsProcessed":  atomic.LoadInt64(&eventsProcessed),
		"assetsDiscovered": atomic.LoadInt64(&assetsDiscovered),
		"cvesDetected":     atomic.LoadInt64(&cvesDetected),
		"uptimeSeconds":    time.Since(workerStart).Seconds(),
		})
	})

	log.Printf("[Discovery] Status server on :%s\n", port)
	shared.RunGracefulServer("discovery_agent", port, nil, func() { shared.DB.Close() })
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmsgprefix)
	log.SetPrefix("[NDSEP-Discovery] ")

	port := os.Getenv("DISCOVERY_PORT")
	if port == "" {
		port = "8082"
	}

	log.Println("=== NDSEP Layer 1 Discovery Agent Worker (Go) ===")

	shared.InitRelay()
shared.InitTracing(shared.TraceConfig{
ServiceName:    "discovery_agent",
ServiceVersion: "3.0.0",
})
	if err := shared.InitDB(); err != nil {
		log.Fatalf("DB init failed: %v\n", err)
	}
	defer shared.DB.Close()

	shared.Broadcast("worker_started", map[string]interface{}{
		"worker":    "discovery_agent",
		"layer":     "L1",
		"language":  "Go",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})

	go runAssetScanWorker()
	go runCVEScanner()
	go runAgentStatusUpdater()

	startStatusServer(port)
}
