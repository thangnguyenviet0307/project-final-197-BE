# Email, password recovery and initial accounts

Configure the variables in `.env.example` in the server environment. The application does not provision a Brevo account or modify production data. No extra dependency is required: Nodemailer and Zod 4 are already installed.

## Brevo setup

1. Create a Brevo account and enable transactional email: https://www.brevo.com/products/transactional-email/.
2. Verify the sender address/domain in Brevo. Complete the DNS authentication requested by Brevo when using a domain.
3. Set `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER` to the SMTP login, `SMTP_PASSWORD` to the SMTP key (not the dashboard password), and `SMTP_FROM` to the verified sender address.
4. Generate an independent secret, for example `node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"`, and set `OTP_SECRET`. Do not reuse JWT/SMTP secrets. Changing it invalidates outstanding OTPs/reset grants.
5. Verify actual delivery to a controlled mailbox, including Spam and returned mail. SMTP acceptance does not guarantee Inbox delivery. Hosting must allow outbound SMTP; this implementation requires TLS and does not disable certificate verification.

Missing configuration causes email operations to fail with 503; the server can still serve existing unrelated functionality. Secrets, email bodies, OTPs and passwords are not logged. Automated tests mock SMTP and do not deliver email.

## Customer recovery

Public endpoints require `X-Login-Area: storefront`:

- `POST /api/v1/customer-auth/send-otp`: `{ "email": "customer@example.com" }`. Returns a generic 200 whether the account exists, is disabled or is cooling down; no email is sent for ineligible accounts. Successful mail submission returns the same message. SMTP unavailability returns 503.
- `POST /api/v1/customer-auth/verify-otp`: `{ "email": "customer@example.com", "otp": "012345" }`. Returns `{ resetToken, expiresIn: 300 }` inside the normal response `data`. This credential is necessary to complete recovery; keep it only in page memory, never in URL or persistent storage.
- `POST /api/v1/customer-auth/reset-password`: `{ "email": "customer@example.com", "resetToken": "...", "newPassword": "NewPassword123!" }`. Revokes existing sessions and removes the recovery state atomically. Reuse of the current password is rejected.

OTP is six digits, generated using Node crypto, expires after five minutes, and permits at most five guesses. Resend cooldown is sixty seconds. A new request replaces the previous challenge/grant. Pending delivery is not verifiable; failures remove only that request's state. HMAC includes its purpose and random challenge identifier. Recovery is tied to email, enabled/active account and tokenVersion, so password/session changes invalidate outstanding grants. Mongo predicates enforce expiry and single consumption; cleanup is not responsible for validity. One bounded recovery subdocument is stored per Customer; completed recovery/password changes remove it. No TTL index can delete an account.

## Provisioned employees

`POST /users` continues accepting an initial password supplied by the provisioning administrator. The frontend creates unpredictable initial credentials and shows them only in the creation form for handover to the employee. The API never returns passwords. Account creation hashes the supplied password, marks onboarding/password change required and sets a deadline thirty minutes after issuance. Existing accounts are not backfilled or locked en masse.

The user must log in and change password before that deadline; login/refresh cannot extend it. Backend middleware blocks business APIs and profile writes during this phase. The final password write rechecks the deadline after hashing. A successful change replaces the temporary hash, removes temporary/pending/verification fields, revokes sessions and requires another login.

After signing in again, `/auth/settings/user` opens immediately. Required fields are firstName, lastName and personalEmail. Profile completion has no thirty-minute deadline. The backend blocks business access until the profile has a verified personalEmail. Phone/location/bio/avatar remain optional.

- `PATCH /api/v1/auth/onboarding/profile`: strict profile JSON with required personalEmail. The existing multipart `PATCH /auth/me` also enforces onboarding requirements.
- `POST /api/v1/auth/email-verification/send-otp`: `{}`; sends to the current saved personalEmail, never an arbitrary supplied address.
- `POST /api/v1/auth/email-verification/verify-otp`: `{ "otp": "012345" }`; verifies the exact saved email/session version and clears onboarding after checking required names. The OTP policy matches customer recovery.

Changing personalEmail clears its verification, pending email/reset state and requires verification again. The previous address's code cannot verify the new address.

## Administrative password reset

`POST /api/v1/users/:id/reset-password` with `{}` requires UserUpdate and the existing managed-role hierarchy: Admin may manage Staff, Super Admin may manage Admin/Staff, and ordinary management cannot reset Super Admin. Backend generates an unpredictable password, stores only an Argon2 hash and sends the password only to the target's verified personalEmail. No fallback to account email and no password in responses. Old `PUT /users/:id` password writes are rejected.

The hash is reserved in pendingPassword while SMTP runs. SMTP failure leaves the existing password intact and clears pending state. Successful delivery activates the hash, starts the thirty-minute deadline, revokes sessions and enables mustChangePassword. Identity/version/address/role predicates prevent a stale delivery from overwriting a concurrent change. SMTP and MongoDB cannot be atomic: a delivered message can become unusable if activation fails; the API reports failure and the administrator must request again.

An incomplete account without a verified personalEmail may need credentials reissued after its initial deadline. `POST /users/:id/reissue-initial-password` accepts `{ "password": "..." }` supplied through the initial provisioning form/dialog and permits only active, incomplete, unverified accounts within the same managed-role scope. It never sends credentials to an unverified address or returns a password. The administrator hands the new initial credentials to the correct employee. Reissue invalidates old credentials/sessions and starts a new thirty-minute deadline.

Expired credentials remain invalid even if their bounded fields still exist. Successful change/reissue removes or replaces them; no historical temporary-password list is stored.

## Verification and deployment

Run `pnpm.cmd typecheck` and `pnpm.cmd test` for backend; frontend checks are documented in the sibling repository. Tests cover expiry, replay, concurrent consumption, attempt caps, SMTP failure, password hashing, session revocation, email changes, role scope and onboarding gates. Database operations use mock adapters; actual MongoDB/SMTP/browser deployment acceptance remains separate. No migrations or production writes are part of this change.

HTTP status codes: 400 invalid input/code/grant, 401 expired credentials/session, 403 insufficient privilege/incomplete onboarding, 409 conflicting account change/ineligible reset, 429 rate limit, 503 email unavailable, 500 unexpected server error. Generic public send responses deliberately conceal account existence. IP and account rate limits are per process; multiple instances require a shared gateway policy for aggregate enforcement. Cooldowns and per-code attempt caps are persisted in MongoDB.
