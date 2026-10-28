# Product merchandising flags

Admin product tables and the full product form edit these boolean fields:

| Field | Meaning | Default |
| --- | --- | --- |
| on_sale | Available for sale; independent of discount | true |
| is_best_seller | Manually selected Best Seller | false |
| is_new | Manually marked new | false |
| is_hot | Manually featured (storefront Nổi bật) | false |
| is_home | Included in the Home product selection | false |

## Quick update

`PATCH /api/v1/products/:id/flags` requires an authenticated admin (ProductUpdate permission), a valid product ID, and the version read from the admin product response:

```json
{ "expectedVersion": 3, "is_best_seller": true, "is_home": true }
```

Send one or more flags. Unknown fields (including prices and stock), non-booleans, missing versions and empty updates return 400. Missing products return 404. Stale versions return 409; reload and review before retrying. Successful responses use the existing product-update JSON envelope and include the updated product/version. The endpoint reuses the existing transactional product-update service.

The full create/update product endpoints also accept all five flags. GET /products and GET /products/public accept string query values true/false for each flag. Legacy missing flags follow their defaults when filtering. Public catalog endpoints always exclude on_sale=false as well as inactive products or inactive catalog references. The main product section offers independent New (is_new), Featured (is_hot), and Home (is_home) buttons. Display order is Home, New, Featured; Home is selected initially. The filters do not additionally require is_home. Home shows products explicitly marked Home; eight desktop slots are retained. Best Seller and Hot are manual selections; no data migration is run.


## Best Seller and views

`is_best_seller` is a manual boolean (default false), supported by create/update, quick flags and list filtering. The Home Best Seller section reads this flag independently of is_home. The obsolete is_best flag is removed from the model/API/UI; historical stored values are unused and are not automatically transferred or deleted.

`count_view` is server-owned, defaults to zero and is exposed read-only in product responses. `POST /api/v1/products/public/:slug/views` with `{}` records one visit using atomic `$inc`, returning `{ data: { count_view: number } }` in the standard response envelope. Invalid slug/body returns 400; missing/non-public products return 404. The counter does not change inventory, metadata version or updatedAt. GET requests never count views. Clients send once per successful product navigation, with no automatic retries. Refresh/re-entry counts again; this is not a unique-visitor metric.

The Most View storefront section and sortBy=count_view support are removed. Product view recording and admin counts are retained. Home, New and Featured query is_home/is_new/is_hot independently; Best Seller keeps its own is_best_seller section.


Availability update: on_sale=false retains the active product on public lists/detail/reviews/related/view counting. The ordering button says temporarily out of stock, and order creation rejects it with 409. is_active=false and inactive/missing catalog references continue to hide products. Price sorting/ranges use the cheapest variant after product discount, rounded half-up to cents. Search covers product, brand and category names.
