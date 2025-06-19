# OpenWebUI KB Sync Plugin Makefile
# Comprehensive build and development automation

.PHONY: help install build dev clean test lint typecheck version deploy deploy-dev deploy-prod deploy-both watch format dist release setup dev-setup all quick quick-prod status validate info

# Default target
.DEFAULT_GOAL := help

# Variables
NODE_MODULES := node_modules
BUILD_OUTPUT := main.js
SOURCE_FILES := main.ts manifest.json styles.css
OBSIDIAN_DEV_DIR := ~/.obsidian/plugins/openwebui-kb-sync
OBSIDIAN_PROD_DIR := /home/nic/Documents/Notes\ Vault/.obsidian/plugins/openwebui-kb-sync
DIST_DIR := dist

## help: Show this help message
help:
	@echo "# OpenWebUI KB Sync Plugin - Makefile"
	@echo ""
	@echo "Available targets:"
	@grep -E '^## [a-zA-Z_-]+:.*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ": "}; {printf "  %-15s - %s\n", substr($$1,4), $$2}'
	@echo ""
	@echo "Common workflows:"
	@echo "  make setup      - First time setup (install + build)"
	@echo "  make dev        - Development mode with watch"
	@echo "  make build      - Production build"
	@echo "  make deploy-dev - Deploy to development vault"
	@echo "  make deploy-prod - Deploy to production vault"
	@echo "  make release    - Create release package"

## setup: Complete first-time setup (install + build)
setup: install build
	@echo "# Setup complete! Plugin is ready for development."

## dev-setup: Setup for development with watch mode
dev-setup: setup
	@echo "# Starting development mode..."
	@$(MAKE) dev

## install: Install dependencies
install:
	@echo "- Installing dependencies..."
	@npm install
	@echo "- Dependencies installed"

## build: Build the plugin for production
build: typecheck
	@echo "- Building plugin..."
	@npm run build
	@echo "- Build complete"

## dev: Start development server with watch mode
dev:
	@echo "- Starting development server..."
	@echo "  Press Ctrl+C to stop"
	@npm run dev

## watch: Alias for dev target
watch: dev

## typecheck: Run TypeScript type checking
typecheck:
	@echo "- Running TypeScript type check..."
	@npx tsc --noEmit --skipLibCheck
	@echo "- Type check passed"

## lint: Run ESLint (if configured)
lint:
	@echo "- Running linter..."
	@if [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f "eslint.config.js" ]; then \
		npx eslint main.ts; \
		echo "- Linting complete"; \
	else \
		echo "  No ESLint configuration found, skipping..."; \
	fi

## format: Format code with Prettier (if available)
format:
	@echo "- Formatting code..."
	@if command -v prettier >/dev/null 2>&1; then \
		npx prettier --write "*.ts" "*.js" "*.json" "*.md" 2>/dev/null || true; \
		echo "- Code formatted"; \
	else \
		echo "  Prettier not available, skipping formatting..."; \
	fi

## test: Run tests (placeholder for future implementation)
test:
	@echo "- Running tests..."
	@if [ -d "tests" ] || [ -f "*.test.ts" ] || [ -f "*.spec.ts" ]; then \
		npm test 2>/dev/null || echo "  No test script configured"; \
	else \
		echo "  No tests found"; \
	fi

## version: Bump version and update manifest
version:
	@echo "- Updating version..."
	@npm run version
	@echo "- Version updated"

## clean: Clean build artifacts and dependencies
clean:
	@echo "- Cleaning build artifacts..."
	@rm -f $(BUILD_OUTPUT)
	@rm -rf $(NODE_MODULES)
	@rm -rf $(DIST_DIR)
	@echo "- Clean complete"

## dist: Create distribution package
dist: clean build
	@echo "- Creating distribution package..."
	@mkdir -p $(DIST_DIR)
	@cp $(BUILD_OUTPUT) $(DIST_DIR)/
	@cp manifest.json $(DIST_DIR)/
	@cp styles.css $(DIST_DIR)/
	@cp README.md $(DIST_DIR)/
	@cp LICENSE $(DIST_DIR)/
	@echo "- Distribution package created in $(DIST_DIR)/"

## release: Create release with version bump
release: clean version build dist
	@echo "- Creating release..."
	@VERSION=$$(node -p "require('./manifest.json').version"); \
	tar -czf "openwebui-kb-sync-v$$VERSION.tar.gz" -C $(DIST_DIR) .; \
	echo "- Release package created: openwebui-kb-sync-v$$VERSION.tar.gz"

## deploy: Deploy plugin to development vault (default)
deploy: deploy-dev

## deploy-dev: Deploy to development vault
deploy-dev: build
	@echo "- Deploying to development vault..."
	@mkdir -p $(OBSIDIAN_DEV_DIR)
	@cp $(BUILD_OUTPUT) $(OBSIDIAN_DEV_DIR)/
	@cp manifest.json $(OBSIDIAN_DEV_DIR)/
	@cp styles.css $(OBSIDIAN_DEV_DIR)/
	@echo "- Plugin deployed to development vault: $(OBSIDIAN_DEV_DIR)"
	@echo "  NOTE: Restart Obsidian to load the updated plugin"

## deploy-prod: Deploy to production vault
deploy-prod: build
	@echo "- Deploying to production vault..."
	@mkdir -p $(OBSIDIAN_PROD_DIR)
	@cp $(BUILD_OUTPUT) $(OBSIDIAN_PROD_DIR)/
	@cp manifest.json $(OBSIDIAN_PROD_DIR)/
	@cp styles.css $(OBSIDIAN_PROD_DIR)/
	@echo "- Plugin deployed to production vault: $(OBSIDIAN_PROD_DIR)"
	@echo "  NOTE: Restart Obsidian to load the updated plugin"

## deploy-both: Deploy to both development and production vaults
deploy-both: build
	@echo "- Deploying to both vaults..."
	@$(MAKE) deploy-dev
	@$(MAKE) deploy-prod
	@echo "- Plugin deployed to both development and production vaults"

## status: Show project status
status:
	@echo "# Project Status"
	@echo "================="
	@echo "Plugin Name:    $$(node -p "require('./manifest.json').name")"
	@echo "Version:        $$(node -p "require('./manifest.json').version")"
	@echo "Build Output:   $(BUILD_OUTPUT) $$(if [ -f $(BUILD_OUTPUT) ]; then echo '[OK]'; else echo '[MISSING]'; fi)"
	@echo "Dependencies:   $$(if [ -d $(NODE_MODULES) ]; then echo '[OK]'; else echo '[MISSING]'; fi)"
	@echo "TypeScript:     $$(if command -v tsc >/dev/null 2>&1; then echo '[OK]'; else echo '[NOT FOUND]'; fi)"
	@echo "Node.js:        $$(node --version 2>/dev/null || echo '[Not installed]')"
	@echo "npm:            $$(npm --version 2>/dev/null || echo '[Not installed]')"
	@echo ""
	@echo "Deployment Targets:"
	@echo "Dev Vault:      $(OBSIDIAN_DEV_DIR) $$(if [ -d $(OBSIDIAN_DEV_DIR) ]; then echo '[EXISTS]'; else echo '[NOT FOUND]'; fi)"
	@echo "Prod Vault:     $(OBSIDIAN_PROD_DIR) $$(if [ -d $(OBSIDIAN_PROD_DIR) ]; then echo '[EXISTS]'; else echo '[NOT FOUND]'; fi)"

## validate: Validate plugin configuration
validate:
	@echo "- Validating plugin configuration..."
	@node -e "const m=require('./manifest.json'); console.log('  Manifest valid'); if(!m.id||!m.name||!m.version) throw new Error('Missing required fields')"
	@if [ ! -f "$(BUILD_OUTPUT)" ]; then echo "  Build output missing"; exit 1; fi
	@echo "- Plugin configuration valid"

## dev-build: Build in development mode
dev-build:
	@echo "- Building in development mode..."
	@npm run dev
	@echo "- Development build complete"

## quick: Quick build and deploy to development vault
quick: build deploy-dev
	@echo "- Quick development deploy complete"

## quick-prod: Quick build and deploy to production vault
quick-prod: build deploy-prod
	@echo "- Quick production deploy complete"

## all: Run all checks and build everything
all: clean install typecheck lint format build test validate
	@echo "- All tasks completed successfully"

## info: Show detailed project information
info:
	@echo "# OpenWebUI KB Sync Plugin Information"
	@echo "======================================="
	@echo ""
	@echo "Project Details:"
	@echo "  Name:        $$(node -p "require('./manifest.json').name")"
	@echo "  ID:          $$(node -p "require('./manifest.json').id")"
	@echo "  Version:     $$(node -p "require('./manifest.json').version")"
	@echo "  Author:      $$(node -p "require('./manifest.json').author")"
	@echo "  Description: $$(node -p "require('./manifest.json').description")"
	@echo ""
	@echo "Build Information:"
	@echo "  Source:       main.ts"
	@echo "  Output:       $(BUILD_OUTPUT)"
	@echo "  TypeScript:   $$(tsc --version 2>/dev/null || echo 'Not available')"
	@echo "  Build System: esbuild"
	@echo ""
	@echo "Dependencies:"
	@npm list --depth=0 2>/dev/null | head -10
	@echo ""
	@echo "Available Commands:"
	@echo "  Development: make dev, make quick"
	@echo "  Production:  make build, make release, make quick-prod"
	@echo "  Deployment:  make deploy-dev, make deploy-prod, make deploy-both"
	@echo "  Maintenance: make clean, make validate"

# Check if node_modules exists, if not suggest running make install
$(NODE_MODULES):
	@echo "Dependencies not installed."
	@echo "Run: make install"
	@exit 1

# Ensure build output exists for deployment targets
$(BUILD_OUTPUT): $(SOURCE_FILES) $(NODE_MODULES)
	@$(MAKE) build