# Order handler hierarchy

Super Admin can choose itself, an active Admin or an active Staff account. Admin
can choose itself or active Staff, never another Admin or Super Admin. Staff may
continue claiming eligible orders only for itself; it cannot reassign orders.

GET `/api/v1/orders/assignees` requires the existing OrderAssign permission and
returns only eligible active accounts with `_id`, `firstName`, `lastName`, `email`,
`role`, plus pagination. Optional search is trimmed, literal and limited to 100
characters; page/limit are bounded and unknown query fields are rejected.
The endpoint precedes `/:id`; it does not expose the user-management API or credentials.

PATCH `/orders/:id/start` with an empty body claims the order for the authenticated
employee. Explicit `{ "userId": "<id>" }` must satisfy the same hierarchy.
The rule also applies to `/orders/:id/assignee`, explicit userId in status updates
and administrative creation. Unchanged existing handlers remain valid for normal
status updates without being considered a new assignment.

Capacity limits, guest reservation expiration, status transitions, transactional
locking and claim race protection remain in place. No production data is migrated.
Out-of-scope/inactive targets return 404 without revealing account existence.

The Admin picker defaults to self on start, supports selecting lower roles, wraps
long names/emails and uses compact pagination. Shared dialog bounds and footer
wrapping keep long forms/actions within the viewport in both light and dark modes.
Browser layout and live MongoDB transaction behavior require environment acceptance.
