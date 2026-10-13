# Release test checklist

What to check by hand before tagging a release, on top of CI (backend tests with the race detector, the authorization matrix and audit-coverage tests, frontend unit / component tests with axe, lint, type check, bundle budget and the image build). Run it against the image that will be released, with a copy of real data where possible.

Tick every line, or write down why it doesn't apply.

## Setup

- [ ] Start the candidate image with a **copy of the production database** (or the previous release's data) and `DATA_ENCRYPTION_KEY` set. The log shows the migrations applied once and `spec.index_backfilled`.
- [ ] A second start applies no migration.
- [ ] `server backup` writes a backup that opens (`sqlite3 backup.db 'PRAGMA integrity_check'` → `ok`).
- [ ] `/livez`, `/readyz` answer 200; `/metrics` (if enabled) lists `portal_*` series.

## Sign-in and sessions

- [ ] Local sign-in; wrong password five times locks the account temporarily (429 with `Retry-After`).
- [ ] A user with *must change password* reaches only the change-password page.
- [ ] LDAP sign-in with a directory account; **Identity providers → LDAP → Test a sign-in** shows each step.
- [ ] Users → New user ▾ → From LDAP…: search, import two people into a group; a name typed into the request that isn't in the directory is reported as *not found*; a username that is a local account is skipped, not converted.
- [ ] As a user manager (`user.view` + `user.manage`, no `idp.manage`): the import works; importing into a group that grants something the manager doesn't hold is refused; the LDAP settings stay closed.
- [ ] LDAP *Create an account at the first sign-in* on, limited to one directory group: a member signs in and lands with an empty catalog (no groups), a non-member is refused, and a directory user whose name is a local account is refused.
- [ ] Users → New user ▾ → Azure AD user…: pre-register someone whose UPN differs from their e-mail, with a group; at their first Microsoft sign-in they get that account (with the group), not a second one.
- [ ] Azure AD sign-in (if configured); *Allowed groups* refuses a non-member with a message.
- [ ] Idle timeout and maximum age end the session; the next action shows one "session ended" toast and returns to the same page after signing in.
- [ ] **Account → Signed-in devices** ends another browser's session immediately.

## Catalog and API pages

- [ ] The catalog lists only APIs the user may view; filters and search survive a reload and Back undoes a filter.
- [ ] Search finds an operation by a word of its summary; the result opens that operation.
- [ ] A viewer sees *Spec error* without the error text; a manager of that API sees the text.
- [ ] Reference: a large spec (1000+ operations) scrolls smoothly; a spec with circular `$ref`s renders.
- [ ] Try-it: a call succeeds; a path outside the allow-list, the rate limit and an unreachable upstream each give their own explanation.
- [ ] Headers the portal adds are listed by name; their values appear nowhere in the page, the snippets or browser storage (DevTools → Application).
- [ ] Snippets for a viewer use `$BASE_URL`; for a manager the internal address.
- [ ] Spec download (JSON and YAML) works; Classic (Swagger UI) loads only on its tab.

## Admin console

- [ ] `/admin` opens the Overview; a user with only `audit.view` sees only Overview and Audit log, and `/admin/users` shows the 403 page.
- [ ] Overview counts match the data; each *Needs attention* item's *Open* lands on the right place.
- [ ] Old bookmarks (`/admin/ldap`, `/admin/azure-ad`, `/admin/session-settings`, `/admin/system`) redirect.
- [ ] Users:
  - [ ] Filters are in the URL.
  - [ ] The active switch is locked for yourself and the last admin, with the reason.
  - [ ] Deactivating someone ends their sessions.
- [ ] Users, bulk: deactivate leaves yourself out; add to group; the CSV opens cleanly in a spreadsheet (no formulas run).
- [ ] User editor:
  - [ ] Changing groups previews the added and removed scopes.
  - [ ] Cancel with unsaved changes asks first.
  - [ ] The Sessions tab ends one session.
- [ ] Delegated user manager (`user.view` + `user.manage`, no `audit.view`): adding a user to a group that grants `audit.view` is refused (403, audited as denied); administrators can't be changed.
- [ ] Groups: add / remove members; the delete dialog names the member and role counts.
- [ ] Roles:
  - [ ] Template and *copy from* fill the matrix.
  - [ ] Saving a changed role in use shows the diff.
  - [ ] The matrix works with the keyboard alone.
- [ ] API wizard:
  - [ ] Preview a good spec, a YAML spec and a non-spec URL (clear message).
  - [ ] Preview a URL on `169.254.169.254`; it must be refused.
  - [ ] Create, then check the review showed header names only.
- [ ] API editor: row *Refresh spec*; the delete dialog's counts; an injected header's value stays write-only after saving.
- [ ] Audit log:
  - [ ] Presets and the action suggestions work.
  - [ ] A filtered view's URL reproduces it.
  - [ ] The export has the same filters.
  - [ ] Every change made above appears exactly once, with its outcome.
- [ ] Settings → System shows the version being released and *From DATA_ENCRYPTION_KEY*.

## Keyboard

- [ ] `?` lists the shortcuts; ⌘K / Ctrl K opens the palette from any page, Esc returns focus where it was.
- [ ] On a **Turkish keyboard**: `[` `]` switch tabs, `/` focuses the search, `?` opens the help.
- [ ] Without a mouse: sign in → palette → operation → ⌘↵ → response read out → `g a` → Users → `j` / Enter → `]` → add a group → Save.
- [ ] VoiceOver (macOS) or NVDA: the palette announces the result count and the active option; try-it announces the response.

## Quality

- [ ] Chrome and Firefox, light and dark theme, English and Turkish: no untranslated strings, no layout breaks.
- [ ] 375 px (phone), 768, 1024 and 1440 px: no horizontal scrolling; drawers and dialogs fit.
- [ ] Keyboard only: every page usable, focus visible, Escape closes drawers and dialogs, focus returns to where it was.
- [ ] CI's `e2e` job is green (axe on every route, both themes, 375 and 1440 px; keyboard flow; performance budgets). Look through its screenshot artifact.
- [ ] Windows high contrast (forced colours): the current page, selected tab / option and switch states are still visible.
- [ ] Browser console: no errors, no CSP violations.

## Deployment

- [ ] `kubectl apply -k deploy/` on a test cluster with the new tag: the pod becomes ready with the read-only root filesystem, and data on the PVC survives a restart.
- [ ] `cosign verify` succeeds for the released tag (see Images in the README).
- [ ] The log stream (if shipped) has `portal.audit` and `portal.http` documents with the new actions.
