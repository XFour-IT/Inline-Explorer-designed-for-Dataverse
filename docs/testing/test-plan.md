# Dataverse Component Inspector Test Plan

## 1. Overview
The Dataverse Component Inspector is a VS Code extension that annotates Dataverse solution XML files by resolving GUIDs to readable component metadata through Microsoft's device-code authentication flow and Dataverse Web API calls.

This plan defines the strategy for manual, unit, and automated testing aligned with Airbnb's JavaScript/TypeScript testing conventions (`describe`/`it`, explicit assertions, deterministic fixtures) and integrates with GitHub-hosted CI/CD.

## 2. Objectives & Scope
- Verify authentication, GUID detection, and inline decoration behaviors end-to-end inside the VS Code host.
- Ensure network and caching utilities correctly interact with Dataverse APIs, including error handling and fallback logic.
- Guard against regressions through automated unit and integration suites executed on every push/pull request via GitHub Actions, alongside linting and type-checking already defined in project scripts.

## 3. Test Environment
- **Primary IDE**: VS Code ≥1.84, matching the extension engine requirement.
- **Node.js**: LTS release compatible with TypeScript 5.x, aligned with the dev dependencies.
- **Authentication**: Access to a Dataverse sandbox with device-code login enabled; ability to provision or mock component metadata.
- **Network Controls**: Ability to toggle offline/timeout scenarios (via tools like `nock`) for negative tests.
- **CI**: GitHub Actions runners on `ubuntu-latest` with Node toolchain.

## 4. Manual Test Matrix
| ID | Scenario | Preconditions | Steps | Expected Result | Coverage |
|----|----------|---------------|-------|-----------------|----------|
| M1 | Initial login flow | Extension packaged & launched in Extension Development Host; user has Dataverse tenant | Run **Dataverse: Login** command → provide valid environment URL, optional client/tenant IDs | Authentication completes, info message appears, and active editor decorations refresh automatically | Validates prompt validations and post-login refresh path |
| M2 | URL validation | Same as M1 | Trigger command → submit blank/invalid URL | Inline validation blocks submission with error message | Ensures guard rails on `showInputBox` validation |
| M3 | GUID annotation (authenticated) | Logged in; XML file containing multiple GUIDs opened | Place cursor on line with GUIDs and move caret across positions | Decoration shows resolved component label/name beside GUID | Confirms regex detection, selection handling, and rendering behavior |
| M4 | Authentication prompt reminder | Logged out; XML file opened | Place caret on GUID line | Decoration prompts login reminder instead of data lookup | Checks unauthenticated guard path |
| M5 | API error handling | Logged in; simulate Dataverse 4xx/5xx | Trigger lookup on GUID | Decoration displays error message without crashing | Validates exception path in decoration manager |
| M6 | Cache reuse | Logged in; same GUID used twice | Trigger lookup twice (with network monitoring) | Second lookup served from cache (no repeated request) | Exercises caching branch of `getComponentInfo` |
| M7 | Unsupported component type | Logged in; GUID for unsupported type | Trigger lookup | Displays “Component <code> - Unknown name” fallback | Verifies fallback label path |
| M8 | Form type annotation | Logged in; GUID referencing form metadata | Trigger lookup | Decoration shows friendly form type suffix (Main, Quick View, etc.) | Covers `resolveFormType` mapping |

**Manual execution cadence**: Before each release candidate; spot-check after major dependency updates.

## 5. Unit Testing Strategy
Adopt Airbnb-style structure with `describe` suites per module and `it` statements for behaviors. Use `mocha` + `chai` with `sinon` for stubs. Keep async tests deterministic and reset spies between tests.

### Targeted Units
1. **`DataverseClient`**
   - `normalizeGuid` validation and formatting of mixed-case or invalid GUID strings.
   - `getComponentInfo` caching: returns cached value when available; triggers API call when absent; handles missing component response.
   - Resolver helpers (`getEntityDisplayName`, `getSystemFormName`, etc.) interpret API payloads and handle missing environment URLs.
   - Error propagation when `apiGet` receives non-OK status.

2. **`GuidDecorationManager`**
   - `isApplicable` only true for XML files.
   - `updateDecorations` branches: empty matches, unauthenticated prompt, success path (mock `DataverseClient`), error path (rejected promise).
   - `applyDecoration` builds expected decoration payload (assert via spies on `setDecorations`).

### Tooling & Configuration
- `npm test` executes unit suite via `mocha` + `ts-node/register` with shared `tests/setup.ts` to mock VS Code APIs.
- Fixtures and mocks for network behavior keep tests deterministic without live HTTP.

## 6. Integration & Automated Testing
- **GuidDecorationManager ↔ DataverseClient Interaction**: Integration tests mock network boundaries but exercise both classes together to confirm request sequencing, loading states, and error display semantics.
- **VS Code Extension Harness**: Future work will connect `@vscode/test-electron` for extension host automation; the current suite isolates logic in a headless environment while leaving seams for host-driven tests.
- **Regression Suite**: Combine unit + integration tests into `npm run test:ci` to execute locally and in CI.

## 7. Static Analysis & Linting
- Continue enforcing Airbnb ESLint rules; ensure tests adhere to `npm run lint`.
- Add TypeScript strict mode checks (already enforced via `tsc --noEmit` in compile step when run).

## 8. Test Data Management
- Store reusable GUID fixtures in `tests/fixtures` as JSON when required.
- Provide mock Dataverse responses within unit tests; ensure anonymized sample data.
- Document how to acquire real GUIDs for manual testing (e.g., from sandbox export) without committing sensitive identifiers.

## 9. CI/CD Integration (GitHub Actions)
Create `.github/workflows/ci.yml` with:
1. Trigger: `pull_request` and `push` to main branches.
2. Jobs:
   - **setup**: checkout, `actions/setup-node`, `npm ci`.
   - **lint**: run `npm run lint`.
   - **tests**: run `npm run test:coverage` (unit + coverage) and `npm run test:integration`.
   - Upload coverage artifacts for review.
3. Status badges can be added to the README once pipeline established.

## 10. Metrics & Reporting
- **Coverage Targets**: ≥80% statements/branches for core modules (`dataverseClient`, `guidDecorationManager`). Use `c8` to produce `lcov` reports for GitHub integrations.
- **Defect Tracking**: Link manual test outcomes and automated failures to GitHub issues; tag with `area/testing`.
- **Release Gate**: CI must pass plus completion of manual regression checklist before tagging release.

## 11. Maintenance
- Review test cases quarterly or when new component resolvers are added to `DataverseClient.componentHandlers`.
- Update fixtures and integration scenarios whenever new commands or activation events are introduced in `package.json`.
- Keep MSAL/device-code mock implementations in sync with library updates to avoid brittle authentication tests.
