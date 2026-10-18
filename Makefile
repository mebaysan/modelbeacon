.DEFAULT_GOAL := help

# Builds and test suites share dist/ and the preview server port.
.NOTPARALLEL:

CODE ?= code

.PHONY: help setup build check test test-unit test-ui test-extension preview dev package install clean

help:
	@printf '%s\n' \
	  'ModelBeacon local development' \
	  '' \
	  '  make setup           Install locked npm dependencies and Chromium for UI tests' \
	  '  make build           Build the extension and webview into dist/' \
	  '  make check           Check TypeScript and validate the public catalog' \
	  '  make test            Run checks, unit tests, UI tests, and VS Code smoke tests' \
	  '  make test-unit       Run unit and host tests' \
	  '  make test-ui         Build and test desktop, narrow, and sidebar layouts' \
	  '  make test-extension  Build and test in an isolated VS Code profile' \
	  '  make preview         Build and serve the browser preview on port 4173' \
	  '  make dev             Build and open a VS Code Extension Development Host' \
	  '  make package         Validate, build, and create modelbeacon.vsix' \
	  '  make install         Package and install/update ModelBeacon in local VS Code' \
	  '  make clean           Remove builds, VSIX, and test reports; keep dependencies/caches' \
	  '' \
	  'Requires Node.js 22.18+, npm, and GNU Make. dev/install also need the code CLI.' \
	  'Override the VS Code CLI with CODE=/path/to/code.'

setup:
	npm ci
	npx --no-install playwright install chromium

build:
	npm run build

check:
	npm run check
	npm run catalog:check

test: check test-unit test-ui test-extension

test-unit:
	npm test

test-ui:
	npm run test:ui

test-extension:
	npm run test:extension

preview:
	npm run preview

dev: build
	"$(CODE)" --new-window --extensionDevelopmentPath="$(CURDIR)" "$(CURDIR)"

package:
	npm run package

install: package
	"$(CODE)" --install-extension "$(CURDIR)/modelbeacon.vsix" --force

clean:
	rm -rf dist playwright-report test-results modelbeacon.vsix
