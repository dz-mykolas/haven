SHELL := /bin/bash
.PHONY: help install db dev api web check test test-integration test-e2e build generate format backup fixtures brand-icons
help:
	@echo 'Haven: install | db | dev | api | web | check | test | test-integration | test-e2e | build | generate | format | backup | fixtures | brand-icons'
install:
	npm ci
	cd apps/api && go mod download
db:
	@if [[ "${HAVEN_DEVCONTAINER:-}" == "1" ]]; then bash scripts/db-ready.sh; else docker compose up -d --wait db; fi
dev:
	@bash scripts/dev.sh
api:
	@source scripts/load-env.sh && cd apps/api && go run ./cmd/server
web:
	ASTRO_DEV_BACKGROUND=0 npm run dev
generate:
	npm run api:generate
check:
	npm run check
	cd apps/api && go vet ./...
test:
	cd apps/api && go test -race ./...
test-integration:
	@source scripts/load-env.sh && test -n "$$HAVEN_TEST_DATABASE_URL" || (echo 'Set HAVEN_TEST_DATABASE_URL to a disposable PostgreSQL database'; exit 1)
	@source scripts/load-env.sh && cd apps/api && go test -race ./internal/httpapi -count=1
test-e2e:
	@source scripts/load-env.sh && npm run test:e2e
build:
	npm run build
	cd apps/api && go build -o haven ./cmd/server
format:
	cd apps/api && gofmt -w cmd internal
	npx prettier --write "apps/web/src/**/*.{tsx,ts,css}" apps/web/astro.config.mjs tests/*.ts
backup:
	@bash scripts/backup.sh

fixtures:
	node scripts/generate-bank-fixtures.mjs

brand-icons:
	node scripts/generate-brand-icons.mjs
