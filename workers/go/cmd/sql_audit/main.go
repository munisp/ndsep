/*
 * NDSEP SQL Injection Audit Tool (Go)
 * =====================================
 * Scans TypeScript server files for SQL injection vulnerabilities.
 * Detects string interpolation in pool.query() calls.
 *
 * Recommendation H5: Audit 981 raw SQL queries for injection
 *
 * Usage: go run ./cmd/sql_audit/main.go -dir ../../server
 */

package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type Finding struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Severity string `json:"severity"` // critical, warning, info
	Category string `json:"category"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

type AuditReport struct {
	TotalFiles     int       `json:"total_files"`
	TotalQueries   int       `json:"total_queries"`
	SafeQueries    int       `json:"safe_queries"`
	UnsafeQueries  int       `json:"unsafe_queries"`
	Warnings       int       `json:"warnings"`
	Findings       []Finding `json:"findings"`
}

var (
	// Patterns that indicate SQL injection risk
	templateLiteralInterp = regexp.MustCompile("pool\\.query\\s*\\(\\s*`[^`]*\\$\\{")
	stringConcat          = regexp.MustCompile("pool\\.query\\s*\\([^)]*\\+\\s*[^,)]+")
	noParamQuery          = regexp.MustCompile("pool\\.query\\s*\\(\\s*['\"`][^'\"]*(?:WHERE|INSERT|UPDATE|DELETE|SET)[^'\"]*['\"`]\\s*\\)")

	// Safe patterns
	parameterized = regexp.MustCompile("\\$\\d+")
	safeQuery     = regexp.MustCompile("pool\\.query\\s*\\(\\s*(?:`[^`]*\\$\\d+[^`]*`|['\"][^'\"]*\\$\\d+[^'\"]*['\"])\\s*,\\s*\\[")
)

func main() {
	dir := flag.String("dir", "../../server", "Directory to scan")
	outputJSON := flag.Bool("json", false, "Output as JSON")
	flag.Parse()

	report := AuditReport{}
	var findings []Finding

	err := filepath.Walk(*dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() || !strings.HasSuffix(path, ".ts") {
			return nil
		}
		// Skip test files and node_modules
		if strings.Contains(path, "node_modules") || strings.Contains(path, ".test.") {
			return nil
		}

		report.TotalFiles++
		fileFn, fileErr := os.Open(path)
		if fileErr != nil {
			return nil
		}
		defer fileFn.Close()

		scanner := bufio.NewScanner(fileFn)
		lineNum := 0
		for scanner.Scan() {
			lineNum++
			line := scanner.Text()

			if !strings.Contains(line, "pool.query") && !strings.Contains(line, ".query(") {
				continue
			}

			report.TotalQueries++

			// Check for template literal interpolation in queries
			if templateLiteralInterp.MatchString(line) {
				report.UnsafeQueries++
				findings = append(findings, Finding{
					File:     path,
					Line:     lineNum,
					Severity: "critical",
					Category: "sql-injection",
					Code:     strings.TrimSpace(line),
					Message:  "Template literal interpolation in SQL query — potential SQL injection",
				})
				continue
			}

			// Check for string concatenation in queries
			if stringConcat.MatchString(line) && !parameterized.MatchString(line) {
				report.UnsafeQueries++
				findings = append(findings, Finding{
					File:     path,
					Line:     lineNum,
					Severity: "critical",
					Category: "sql-injection",
					Code:     strings.TrimSpace(line),
					Message:  "String concatenation in SQL query — potential SQL injection",
				})
				continue
			}

			// Check for queries without parameters that contain WHERE/INSERT/etc
			if noParamQuery.MatchString(line) && !parameterized.MatchString(line) {
				report.Warnings++
				findings = append(findings, Finding{
					File:     path,
					Line:     lineNum,
					Severity: "warning",
					Category: "unparameterized",
					Code:     strings.TrimSpace(line),
					Message:  "SQL query with filter clause but no parameterization — verify manually",
				})
				continue
			}

			report.SafeQueries++
		}
		return nil
	})

	if err != nil {
		fmt.Fprintf(os.Stderr, "Error walking directory: %v\n", err)
		os.Exit(1)
	}

	report.Findings = findings

	if *outputJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(report)
	} else {
		fmt.Printf("\n=== NDSEP SQL Injection Audit Report ===\n")
		fmt.Printf("Files scanned: %d\n", report.TotalFiles)
		fmt.Printf("Total queries: %d\n", report.TotalQueries)
		fmt.Printf("Safe (parameterized): %d\n", report.SafeQueries)
		fmt.Printf("Unsafe (injection risk): %d\n", report.UnsafeQueries)
		fmt.Printf("Warnings (manual review): %d\n", report.Warnings)
		fmt.Println()

		for _, f := range findings {
			icon := "⚠️"
			if f.Severity == "critical" {
				icon = "🔴"
			}
			fmt.Printf("%s [%s] %s:%d\n   %s\n   Code: %s\n\n", icon, f.Severity, f.File, f.Line, f.Message, f.Code)
		}

		if report.UnsafeQueries == 0 {
			fmt.Println("✅ No SQL injection vulnerabilities detected!")
		}
	}
}
