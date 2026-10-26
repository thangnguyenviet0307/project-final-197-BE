# Product metadata and DummyJSON import

All catalog prices are VND. Existing prices are unchanged and are treated as VND; no exchange-rate migration runs. Weight uses kg and dimensions use cm. `model_year` is optional and nullable. Product SKU is optional, uppercase and unique; it must not collide with variant SKUs. Barcode is a string, preserving leading zeroes.

Optional product metadata accepted by the existing create/update endpoints: `sku`, `barcode`, `currency` (only `VND`), `tags`, `weight`, `dimensions: { width, height, depth }`, `warrantyInformation`, `shippingInformation`, `returnPolicy`, `minimumOrderQuantity` (default 1). Order creation enforces the minimum across selected variants of a product. A minimum exceeding stock is allowed as catalog metadata but prevents ordering until stock is sufficient or the minimum is changed.

## Import

`POST /api/v1/products/import/dummyjson` requires admin product-create permission. Request:

```json
{
  "sourceCurrency": "USD",
  "exchangeRate": 25000,
  "weightUnit": "kg",
  "dimensionUnit": "cm",
  "product": {
    "id": 1,
    "title": "Essence Mascara Lash Princess",
    "category": "beauty",
    "brand": "Essence",
    "price": 9.99,
    "discountPercentage": 7.17,
    "stock": 5,
    "sku": "RCH45Q1A",
    "images": [],
    "reviews": []
  }
}
```

The rate above is an example, not a fetched or recommended rate. The caller must confirm source currency and units and convert units before submitting. Prices are multiplied by the supplied rate and rounded to the nearest VND. Discounts above 70% are rejected, never silently clamped. Missing brand/category is rejected. Active existing references are resolved by slug; optional `categoryId` / `brandId` override slug matching. Import does not create catalog references implicitly.

Mapping: `title -> product_name`, `discountPercentage -> discount`, `meta.barcode -> barcode`. Source ID, timestamps, currency and applied rate are retained separately from internal IDs/timestamps. Source keys cannot be changed through generic product updates. A repeated source/ID returns 409 instead of overwriting prices or stock. This endpoint imports new products; it does not automatically synchronize existing imports.

Imported products start inactive. HTTPS source image URLs are retained in `sourceImages` for admin reference only. Download images separately and upload files using the existing `POST /products/:id/images` endpoint (at most eight gallery images); Cloudinary ownership and cleanup remain unchanged. No server-side remote fetching is performed. Placeholder `"..."` URLs must be replaced or omitted before import. Inspect the catalog entry and activate it with the existing product update endpoint after uploading images.

Product and imported reviews are written in one MongoDB transaction. Transactions require the existing replica-set/sharded database configuration. Import records reviews with `source: "dummyjson"`; reviewer emails are discarded. Source `rating` is ignored: stars are calculated from the actual imported review records. For the original example (2, 2, 5), the result is rating 3.0 and reviewCount 3, not the independent source rating 4.94.

## Ratings and sales

The public `GET /api/v1/storefront/products/:slug` response now includes `rating` (one decimal, zero if empty), `reviewCount`, `soldCount`, `currency` and the new metadata. `soldCount` sums item quantities from completed orders only, including historical orders. Pending, processing and rejected orders are excluded. These three metrics are calculated from records, not editable counters. No availability-status or QR field is added.

`GET /api/v1/storefront/products/:slug/reviews?page=1&limit=10` lists public reviews for active products with active references. It returns name, stars, comment, date and source; emails and internal identifiers are excluded.

Authenticated admin/staff can read `GET /products/:id/metrics` and paginated `GET /products/:id/reviews`. Admin can add curated reviews via `POST /products/:id/reviews` with `{ rating, comment, reviewerName, date? }`, and remove one via `DELETE /products/:id/reviews/:reviewId`. Admin-created records are marked `source: "admin"`. These are catalog administration operations, not customer-submitted or verified-purchase reviews. No customer review submission UI or frontend rendering is implemented here.

New product SKU/source uniqueness indexes must be present before concurrent imports; follow the deployment's existing index-management process. No production migration, import or index build is executed by this change. Review and sales aggregates are computed at read time; large catalogs may later need batched aggregation or a maintained projection.
