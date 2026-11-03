# Customer warranty requests

Base path: `/api/v1/support`. Customer routes use the storefront Customer session;
administrative routes use User sessions (Super Admin/Admin/Staff).

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/customer/eligible-orders?page=1&limit=10&orderId=<optional-id>` | Completed orders belonging to the current Customer only |
| POST | `/customer/requests` | Create or replay a warranty application |
| GET | `/customer/requests?page=1&limit=10&status=submitted` | Customer's own requests; status is optional |
| GET | `/customer/requests/:id` | Owned detail, history and signed image URLs |
| POST | `/customer/requests/:id/images` | Multipart `image`, one file per call |
| GET | `/admin/requests` | Store request list with optional page/limit/status |
| GET | `/admin/requests/:id` | Administrative detail and contact snapshots |
| PATCH | `/admin/requests/:id` | Accept or transition with a customer-visible response |

Create body: `{ "requestId": "<UUID>", "orderId": "<ObjectId>", "itemIndex": 0,
"description": "A description between 10 and 3000 characters" }`.
Customer identity and purchased product names always come from Backend records.
Guest orders and another customer's orders cannot be claimed through this API.
Optional orderId on eligible-orders narrows the ownership/completed-order scope;
it never bypasses it. Unknown fields and invalid filters are rejected.

PATCH body: `{ "expectedVersion": 2, "status": "repairing", "note": "Customer-visible response" }`.
Transitions: submitted -> reviewing -> repairing/resolved/rejected;
repairing -> resolved/rejected. Resolved/rejected cannot reopen. Accepting assigns
the authenticated employee. Staff may handle only their own accepted requests;
Admin/Super Admin may handle all. Updates append history atomically and stale
versions return 409 VERSION_CONFLICT. Processing does not change stock, payment
or order status. Applications are subject to review under the actual store policy.

Creation uses durable Customer/requestId replay protection. Identical retries return
the saved request; changed payloads conflict. The open frontend form keeps the same
requestId/body for uncertain retries and guards navigation/unload. Forced reload or
closing the tab does not persist the local draft: check the request list before creating again.

Images: at most five JPG/PNG/WebP files of 5 MB each, while still submitted. Signature
validation, ownership, version and capacity checks run on Backend. Identical bytes are
deduplicated for retries. Cloudinary authenticated assets expose one-hour signed URLs;
failed uploads/links are cleaned up or enqueued for cleanup. Preview/retry retains the
same File locally and does not mark an upload successful before server confirmation.

Customer UI: `/account/orders` offers per-item links on Completed orders to
`/account/warranty?new=1&order=<id>&item=<index>`. Preselection requires a matching
item returned by the owned eligible-orders API. General entry: `/account/warranty`.
After creation the detail appears before the request list, with a success message,
image attachment controls and history. Admin entry: `/auth/warranties`.

The creation form also accepts up to five local photos before submission. It first
confirms request creation, then uploads through the same existing image endpoint.
On partial failure it retains the created request ID and Files, skips already
confirmed uploads and offers a safe retry or opening the created request. Post-create
attachment controls remain available. See CATALOG_IMAGES_API.md for the shared limits.

The existing warranty_requests model, index setup and storage are reused. No production
data or historical migrations are performed. Real environment acceptance must verify
MongoDB persistence and browser upload/delivery using CLOUDINARY_CLOUD_NAME,
CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET; mocked tests do not validate the live provider.
