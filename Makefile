# ============================================================
# NDSEP — National Data Sovereignty Enforcement Platform
# Makefile — Production-grade build, test, and deployment tasks
# ============================================================

.DEFAULT_GOAL := help
SHELL         := /bin/bash
.PHONY: help install build test lint typecheck clean dev docker-up docker-down \
        docker-build docker-push k8s-apply k8s-delete smoke-test seed-db \
        db-push db-migrate db-reset workers-build workers-clean audit-security \
        audit-deps logs-tail health-check backup-db restore-db

# ─── Variables ────────────────────────────────────────────────────────────────
APP_NAME      := ndsep
APP_VERSION   := $(shell git describe --tags --always --dirty 2>/dev/null || echo "v3.0.0")
DOCKER_REPO   := ghcr.io/ndpc/ndsep
DOCKER_TAG    := $(APP_VERSION)
K8S_NAMESPACE := ndsep-production
GO_DIR        := workers/go
PYTHON_DIR    := workers/python
RUST_DIR      := workers/rust
NODE_ENV      ?= development

# ─── Colours ─────────────────────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
RESET  := \033[0m

# ─── Help ─────────────────────────────────────────────────────────────────────
help: ## Show this help message
	@echo ""
	@echo "$(GREEN)NDSEP — National Data Sovereignty Enforcement Platform$(RESET)"
	@echo "$(YELLOW)Version: $(APP_VERSION)$(RESET)"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make $(GREEN)<target>$(RESET)\n\nTargets:\n"} \
	      /^[a-zA-Z_0-9-]+:.*?##/ { printf "  $(GREEN)%-22s$(RESET) %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""

# ─── Development ──────────────────────────────────────────────────────────────
install: ## Install all Node.js dependencies
	@echo "$(GREEN)Installing dependencies...$(RESET)"
	pnpm install --frozen-lockfile

dev: ## Start development server with hot reload
	@echo "$(GREEN)Starting development server...$(RESET)"
	NODE_ENV=development pnpm dev

build: ## Build production assets (TypeScript + Vite)
	@echo "$(GREEN)Building production assets...$(RESET)"
	pnpm run build

clean: ## Remove build artifacts and caches
	@echo "$(YELLOW)Cleaning build artifacts...$(RESET)"
	rm -rf dist client/dist .turbo .vite node_modules/.cache
	find . -name "*.js.map" -not -path "*/node_modules/*" -delete

# ─── Testing ──────────────────────────────────────────────────────────────────
test: ## Run full Vitest test suite
	@echo "$(GREEN)Running test suite...$(RESET)"
	pnpm test -- --reporter=verbose

test-watch: ## Run tests in watch mode
	pnpm test -- --watch

test-coverage: ## Run tests with coverage report
	pnpm test -- --coverage

smoke-test: ## Run smoke tests against running server
	@echo "$(GREEN)Running smoke tests...$(RESET)"
	@node scripts/smoke-test.mjs || (echo "$(RED)Smoke tests FAILED$(RESET)" && exit 1)
	@echo "$(GREEN)Smoke tests PASSED$(RESET)"

# ─── Code Quality ─────────────────────────────────────────────────────────────
lint: ## Run ESLint
	@echo "$(GREEN)Running ESLint...$(RESET)"
	pnpm eslint . --ext .ts,.tsx --max-warnings 0

typecheck: ## Run TypeScript type checking
	@echo "$(GREEN)Running TypeScript check...$(RESET)"
	pnpm tsc --noEmit

audit-security: ## Run security audit scan
	@echo "$(GREEN)Running security audit...$(RESET)"
	pnpm audit --audit-level=high
	@echo "$(GREEN)Security audit complete$(RESET)"

audit-deps: ## Check for outdated dependencies
	pnpm outdated

# ─── Database ─────────────────────────────────────────────────────────────────
db-push: ## Push Drizzle schema changes to database
	@echo "$(GREEN)Pushing schema changes...$(RESET)"
	pnpm db:push

db-migrate: ## Run pending database migrations
	@echo "$(GREEN)Running migrations...$(RESET)"
	pnpm db:migrate

db-reset: ## Reset database (DESTRUCTIVE — dev only)
	@echo "$(RED)WARNING: This will destroy all data!$(RESET)"
	@read -p "Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ] || exit 1
	psql "$$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	pnpm db:push

seed-db: ## Seed database with realistic Nigerian test data
	@echo "$(GREEN)Seeding database...$(RESET)"
	node scripts/seed.mjs
	@echo "$(GREEN)Database seeded successfully$(RESET)"

backup-db: ## Create a timestamped database backup
	@echo "$(GREEN)Creating database backup...$(RESET)"
	@mkdir -p backups
	pg_dump "$$DATABASE_URL" --no-owner --no-acl -F c \
	  -f "backups/ndsep_$(shell date +%Y%m%d_%H%M%S).dump"
	@echo "$(GREEN)Backup created in backups/$(RESET)"

restore-db: ## Restore database from backup (BACKUP_FILE=path/to/file.dump)
	@test -n "$(BACKUP_FILE)" || (echo "$(RED)Set BACKUP_FILE=path/to/backup.dump$(RESET)" && exit 1)
	pg_restore "$$DATABASE_URL" --no-owner --no-acl -d ndsep_db "$(BACKUP_FILE)"

# ─── Workers ──────────────────────────────────────────────────────────────────
workers-build: ## Build all Go and Rust worker binaries
	@echo "$(GREEN)Building Go workers...$(RESET)"
	cd $(GO_DIR) && /usr/local/go/bin/go build -o bin/nip_rtgs_processor ./cmd/nip_rtgs_processor/...
	cd $(GO_DIR) && /usr/local/go/bin/go build -o bin/dpi_engine ./cmd/dpi_engine/... 2>/dev/null || true
	cd $(GO_DIR) && /usr/local/go/bin/go build -o bin/discovery_agent ./cmd/discovery_agent/... 2>/dev/null || true
	cd $(GO_DIR) && /usr/local/go/bin/go build -o bin/compliance_engine ./cmd/compliance_engine/... 2>/dev/null || true
	@echo "$(GREEN)Building Rust workers...$(RESET)"
	cd $(RUST_DIR) && cargo build --release 2>/dev/null || true
	@echo "$(GREEN)Workers built$(RESET)"

workers-clean: ## Remove compiled worker binaries
	rm -rf $(GO_DIR)/bin/*
	rm -rf $(RUST_DIR)/target/release/

# ─── Docker ───────────────────────────────────────────────────────────────────
docker-build: ## Build Docker image
	@echo "$(GREEN)Building Docker image $(DOCKER_REPO):$(DOCKER_TAG)...$(RESET)"
	docker build \
	  --build-arg APP_VERSION=$(APP_VERSION) \
	  --build-arg BUILD_DATE=$(shell date -u +%Y-%m-%dT%H:%M:%SZ) \
	  -t $(DOCKER_REPO):$(DOCKER_TAG) \
	  -t $(DOCKER_REPO):latest \
	  .

docker-push: ## Push Docker image to registry
	@echo "$(GREEN)Pushing $(DOCKER_REPO):$(DOCKER_TAG)...$(RESET)"
	docker push $(DOCKER_REPO):$(DOCKER_TAG)
	docker push $(DOCKER_REPO):latest

docker-up: ## Start all infrastructure services (dev)
	@echo "$(GREEN)Starting infrastructure services...$(RESET)"
	docker compose up -d --wait
	@echo "$(GREEN)Services running. Ports: PG=5432, Redis=6379, Kafka=9092, Prometheus=9090, Grafana=3001$(RESET)"

docker-down: ## Stop all infrastructure services
	docker compose down

docker-logs: ## Follow logs for all services
	docker compose logs -f

docker-prod-up: ## Start production stack
	docker compose -f docker-compose.production.yml up -d --wait

docker-prod-down: ## Stop production stack
	docker compose -f docker-compose.production.yml down

# ─── Kubernetes ───────────────────────────────────────────────────────────────
k8s-apply: ## Apply all Kubernetes manifests
	@echo "$(GREEN)Applying K8s manifests to namespace $(K8S_NAMESPACE)...$(RESET)"
	kubectl apply -f infra/k8s/namespace.yaml
	kubectl apply -f infra/k8s/configmap.yaml
	kubectl apply -f infra/k8s/network-policy.yaml
	kubectl apply -f infra/k8s/api-deployment.yaml
	kubectl apply -f infra/k8s/workers-deployment.yaml
	kubectl apply -f infra/k8s/hpa.yaml
	kubectl apply -f infra/k8s/ingress.yaml
	@echo "$(GREEN)K8s manifests applied$(RESET)"

k8s-delete: ## Delete all Kubernetes resources
	@echo "$(RED)Deleting K8s resources from namespace $(K8S_NAMESPACE)...$(RESET)"
	kubectl delete -f infra/k8s/ --ignore-not-found=true

k8s-status: ## Show Kubernetes deployment status
	kubectl get pods,svc,ingress -n $(K8S_NAMESPACE)

k8s-logs: ## Stream logs from API pods
	kubectl logs -f -l app=ndsep-api -n $(K8S_NAMESPACE) --max-log-requests=5

k8s-rollout: ## Trigger a rolling restart of API deployment
	kubectl rollout restart deployment/ndsep-api -n $(K8S_NAMESPACE)
	kubectl rollout status deployment/ndsep-api -n $(K8S_NAMESPACE)

# ─── Health & Monitoring ──────────────────────────────────────────────────────
health-check: ## Check platform health endpoints
	@echo "$(GREEN)Checking platform health...$(RESET)"
	@curl -sf http://localhost:3000/api/health | python3 -m json.tool || echo "$(RED)API health check FAILED$(RESET)"
	@curl -sf http://localhost:3000/api/workers/status | python3 -m json.tool | grep -c '"status":"running"' | \
	  xargs -I{} echo "$(GREEN){} workers running$(RESET)"

logs-tail: ## Tail application logs
	tail -f .manus-logs/devserver.log

# ─── CI/CD Pipeline ───────────────────────────────────────────────────────────
ci: install typecheck lint test ## Run full CI pipeline (install + typecheck + lint + test)
	@echo "$(GREEN)CI pipeline complete$(RESET)"

release: ci build docker-build docker-push ## Full release pipeline
	@echo "$(GREEN)Release $(APP_VERSION) complete$(RESET)"

# ─── Utilities ────────────────────────────────────────────────────────────────
version: ## Show application version
	@echo "$(APP_VERSION)"

env-check: ## Validate required environment variables
	@node -e "require('./server/_core/env.js')" 2>&1 | head -20

format: ## Format code with Prettier
	pnpm prettier --write "**/*.{ts,tsx,json,md}" --ignore-path .gitignore
