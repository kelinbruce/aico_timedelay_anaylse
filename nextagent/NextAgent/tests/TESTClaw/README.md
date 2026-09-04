# TESTClaw - NextAgent Binary Package Test Framework

TESTClaw is a standalone black-box testing framework for validating the functionality, performance, reliability, and frontend UI of the NextAgent binary package.

## Directory Structure

```text
TESTClaw/
├── target/                    # NextAgent binary package (extract here)
│   ├── bin/                   # nextagent-start, nextagent-stop, nextagent-self-check
│   ├── config/                # default-system.json, default-agent.yaml
│   ├── backend/               # Compiled backend code
│   └── ...
├── tests/
│   ├── helpers/               # Test helper utilities
│   ├── fixtures/              # Test fixtures
│   ├── suites/
│   │   ├── add-ts-contract-test-gate/   # Vitest backend tests (9 files, 144 tests)
│   │   │   ├── 01-functional.test.ts    # 58 tests
│   │   │   ├── 02-performance.test.ts   # 12 tests
│   │   │   ├── 03-reliability.test.ts   # 10 tests
│   │   │   ├── 04-compatibility.test.ts # 8 tests
│   │   │   ├── 05-security.test.ts      # 6 tests
│   │   │   ├── 06-serviceability.test.ts # 8 tests
│   │   │   ├── 07-e2e.test.ts           # 16 tests
│   │   │   ├── 08-contract.test.ts      # 11 tests
│   │   │   └── 09-architecture.test.ts  # 15 tests
│   │   └── add-ts-architecture-test-gate/ # Playwright E2E tests (241 files)
│   │       ├── business-flow/            # 53 files (55 active + 20 skip)
│   │       ├── spec-shall/               # 148 files (144 active + 4 skip)
│   │       ├── concurrency/              # 9 files (9 active)
│   │       ├── non-functional/           # 15 files (10 active + 23 skip)
│   │       └── ui-interaction/           # 16 files (9 active + 8 skip)
│   ├── vitest.config.ts
│   └── playwright.config.ts
├── scripts/
│   ├── setup-package.mjs
│   └── run-tests.ps1          # Unified test runner script
├── test-output/               # Test artifacts (results, reports, logs)
├── package.json
└── README.md
```

## Setup

### 1. Install Dependencies

```powershell
cd <project-root>/tests/TESTClaw
npm install
```

### 2. Prepare target/ Directory

If the `target/` directory does not exist, create it first:

```
powershell
mkdir target
```

### 3. Extract NextAgent Binary Package

Extract `local-build-YYYYMMDD-win32-x64.zip` to the `target/` directory:

```powershell
Expand-Archive -Path "<download-path>/local-build-YYYYMMDD-win32-x64.zip" -DestinationPath "target"
```

### 4. Create package.json in target/

The with-frontend profile requires a `package.json` in the `target/` root:

```powershell
cd target
Set-Content -Path "package.json" -Value '{"name":"@nextagent/local-runtime","version":"0.1.0"}'
```

### 5. Configure Model API

The NextAgent package needs model API configuration to run properly. There are two approaches:

**Option A: Environment Variables (Recommended)**

Keep the default `target/config/default-system.json` as-is (it uses `env:` references), and set environment variables before starting:

```powershell
$env:OPENAI_API_KEY = "your-api-key"
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_MODEL_NAME = "gpt-4o"
```

**Option B: Direct Config Edit**

Edit `target/config/default-system.json`, modify the `modelProfiles` section:

```json
"modelProfiles": [
  {
    "providerId": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "credentialRef": "file:config/api-key.txt",
    "models": [
      {
        "modelId": "gpt-4o",
        "contextWindowTokens": 128000,
        "fallbackEligible": false
      }
    ]
  }
]
```

Then create `target/config/api-key.txt` with your API key.

**Important:** `credentialRef` must use `env:` or `file:` reference. Writing the API key as plaintext will cause the "App configuration is blocked before ready" error.

## Running Tests

### System integration gate (122 independent cases)

The system integration suite owns `TC-SI-001` through `TC-SI-122`: 3 integration cases and 119 E2E cases. Every case has a unique execution file and evidence record; source-test reports are not accepted as results.

Prepare the version-matched local browser test-host artifact from the repository root:

```powershell
npm run build:testclaw-host-artifact
```

Then provide the immutable candidate and external package roots:

```powershell
$env:NEXTAGENT_PACKAGE_ROOT = '<candidate-root>'
$env:NEXTAGENT_EXTERNAL_PACKAGES_ROOT = '<external-packages-root>'
npm --prefix tests/TESTClaw run test:system-integration:sync
npm --prefix tests/TESTClaw run test:system-integration
```

The standard command passes only when all 122 cases pass. Its machine report is written to `test-output/system-integration/<runId>/report.json`. The local test-host artifact is test-only and does not alter the formal immersive/PIU frontend package.

### Method 1: Using run-tests.ps1 (Recommended)

The script handles service lifecycle, logging, timing, and progress automatically.

**Full test run (backend + E2E):**

```powershell
cd <project-root>/tests/TESTClaw
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_MODEL_NAME = "gpt-4o"
.\scripts\run-tests.ps1 -All
```

You can also run the same full pack from the package root:

```powershell
npm run pack
```

The script will:
- Run `nextagent-self-check` to validate configuration
- Auto-start NextAgent service (background)
- Run Vitest backend tests
- Run Playwright E2E tests
- Auto-stop NextAgent service
- Print timing summary

**Backend tests only:**

```powershell
.\scripts\run-tests.ps1 -Backend
```

**E2E tests only (NextAgent already running):**

```powershell
.\scripts\run-tests.ps1 -E2E -NoStart
```

**E2E tests only (auto-start service):**

```powershell
.\scripts\run-tests.ps1 -E2E
```

**Keep service running after tests:**

```powershell
.\scripts\run-tests.ps1 -All -KeepRunning
```

### Method 2: Manual Commands

**Terminal 1 - Start NextAgent:**

```powershell
cd <project-root>/tests/TESTClaw/target
$env:OPENAI_API_KEY = "your-key"
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_MODEL_NAME = "gpt-4o"
node bin\nextagent-start
```

**Terminal 2 - Run tests:**

```powershell
cd <project-root>/tests/TESTClaw
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Backend + E2E (both run regardless of each other's result)
npm.cmd run test; npm.cmd run test:e2e

# Backend only
npm.cmd run test

# E2E only
npm.cmd run test:e2e
```

**Save output to file:**

```powershell
npm.cmd run test; npm.cmd run test:e2e 2>&1 | Tee-Object -FilePath "test-output/full-run-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
```

**Terminal 1 - Stop NextAgent:**

```powershell
cd target
node bin\nextagent-stop
```

## Self-Check

Before starting, verify the package is correctly set up:

```powershell
cd target
node bin\nextagent-self-check
```

This must be run from the `target/` directory. If it reports errors, check the configuration.

## Test Reports

| Output | Path |
|--------|------|
| Vitest JSON | `test-output/vitest-results.json` |
| Playwright HTML | `test-output/playwright-report/index.html` |
| Playwright JSON | `test-output/playwright-results.json` |
| Run log | `test-output/testclaw-YYYYMMDD-HHMMSS.log` |

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `OPENAI_API_KEY` | API key (env: reference in config) | Yes |
| `OPENAI_BASE_URL` | API base URL (env: reference in config) | Yes |
| `OPENAI_MODEL_NAME` | Model name (env: reference in config) | Yes |

## Troubleshooting

### "App configuration is blocked before ready"

Configuration validation failed. Check:
1. `target/package.json` exists
2. `credentialRef` in `default-system.json` uses `env:` or `file:` reference (not plaintext key)
3. Environment variables are set before running
4. Commands are run from the `target/` directory for self-check

### "ENOENT: no such file or directory, open 'package.json'"

Create `target/package.json`:

```powershell
cd target
Set-Content -Path "package.json" -Value '{"name":"@nextagent/local-runtime","version":"0.1.0"}'
```

### Playwright tests all fail with "ECONNREFUSED"

NextAgent service is not running. Start it first or remove `-NoStart` from the script.

### "Local runtime package cannot start before layout and config validation pass"

Same root cause as "App configuration is blocked" above. Verify API environment variables are set in the same terminal session where you start NextAgent.

### Chinese characters appear as garbled text in terminal

The `run-tests.ps1` script handles this automatically. For manual commands, run:

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

### Vitest fails with "Could not resolve 'vitest/config'"

Use `npm.cmd run test` instead of `npx vitest`. The `npx.ps1` script has a known argument parsing bug on Windows.

## Debug Modes

### Vitest Watch Mode

```powershell
npm.cmd run test:watch
```

### Playwright UI Mode

```powershell
npm.cmd run test:e2e:ui
```

### Playwright Debug Mode

```powershell
npm.cmd run test:e2e:debug
```

## Test Data Cleanup

Test runs create SQLite files in `data/system/test-data/`. Clean up:

```powershell
Remove-Item -Path "data\system\test-data\*.sqlite" -Force
```

## Extending Tests

### Add Vitest Tests

Create `*.test.ts` files under `tests/suites/add-ts-contract-test-gate/`:

```ts
import { describe, expect, it } from "vitest";
import { readManifest } from "../../helpers/evidence-reader.js";

describe("My custom test", () => {
  it("should pass", () => {
    const manifest = readManifest();
    expect(manifest.candidateId).toBeDefined();
  });
});
```

### Add Playwright Tests

Create `*.spec.ts` files under any `tests/suites/<suite>/` directory:

```ts
import { expect, test } from "@playwright/test";

test("My custom E2E test", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000");
  await expect(page.locator("body")).toBeVisible();
});
```

## Tech Stack

- **Vitest 4.1.8**: Backend unit/integration/contract tests
- **Playwright 1.60**: Frontend E2E UI tests
- **Node.js 24.x**: Runtime

## License

MIT
