# Src Services

This document describes the business-logic layer in `src/services`. Controllers
call these modules; they talk to MongoDB models and throw errors that the
error middleware maps to HTTP responses.

There is no orders service. Login exists in both `auth.service.ts` (used by
the auth controller) and `user.service.ts` (admin user CRUD plus a second
login helper).

| File | Export | Domain |
| :--- | :--- | :--- |
| `auth.service.ts` | default `{ login, register }` | Staff/admin authentication |
| `user.service.ts` | named `UserService` | User CRUD and login |
| `products.service.ts` | default product functions | Products and variants |
| `categories.service.ts` | class `CategoriesService` | Category tree CRUD |
| `brands.service.ts` | class `BrandService` | Brand CRUD with soft delete |

---

# Auth service

`src/services/auth.service.ts` — used by `src/controllers/auth.controller.ts`.

## `login(email, password)`

Finds the user by email, rejects inactive accounts, compares the password
with bcrypt, then signs a JWT (`id`, `role`) that expires in one day.

**Success return**

```ts
{ token: string, user: IUser }
```

The user document’s `toJSON` omits `password`. The controller wraps this in
`{ success, message, data }`.

**Errors**

- `404` — no user for that email (`Email hoặc mật khẩu không chính xác!`)
- `403` — `status === "inactive"`
- `401` — wrong password

**Notes**

- JWT secret is `process.env.JWT_SECRET`, falling back to
  `"default_secret_key_123"`.
- The user schema does **not** set `password: { select: false }`, so
  `User.findOne({ email })` already includes the hash.

## `register({ name, email, password, role? })`

Rejects duplicate emails, hashes the password (`bcrypt`, cost 10), then
creates a user with `fullName` taken from `name`.

**Success return:** the new Mongoose user document.

**Error:** `400` if the email is already used.

**Notes**

- Optional `role` is accepted in the function signature but is **not**
  passed to `User.create`. New accounts always get the model default
  (`staff`).
- The auth controller currently sends `{ name: fullName, email, password }`
  (no role). See `MD/auth.controller.md`.

---

# User service

`src/services/user.service.ts` — used by `src/controllers/user.controller.ts`.
Passwords are hashed with bcrypt (`genSalt(10)`) on create and update.

User fields from `src/models/user.model.ts`: `fullName`, `email`,
`password`, `phone?`, `role` (`admin` | `staff`, default `staff`), `status`
(`active` | `inactive`, default `active`), timestamps.

## `getAllUsers()`

`User.find().select("-password")`. Returns every user, including inactive.

## `getUserById(userId)`

Same projection. **Error:** `404` `Không tìm thấy người dùng`.

## `createUser(userData: Partial<IUser>)`

If `email` is present, rejects an existing email (`400` `Email đã tồn tại
trong hệ thống`). Hashes `password` when provided. Does not check
inactive-account rules.

Mongoose still requires `fullName`, `email`, and `password` at save time.

## `loginUser({ email, password })`

Separate from `auth.service.login`. Loads the user with `.select("+password")`,
compares the hash, then returns a JWT (`id`, `role`, 1 day).

**Success return**

```ts
{
  message: "Đăng nhập thành công",
  token: string,
  user: { id, fullName, email, role }
}
```

**Errors**

- `400` — missing email or password
- `401` — unknown email or wrong password

**Notes:** does **not** check `status === "inactive"`. Does not return
`status` on the user object.

## `updateUser(userId, updateData)`

Hashes a new password when present. Uses `findByIdAndUpdate` with
`{ new: true }` and omits password in the result.

**Error:** `404` `Không tìm thấy người dùng để cập nhật`.

Does not re-check unique email if `email` is changed.

## `deleteUser(userId)`

Hard delete (`findByIdAndDelete`).

**Success:** `{ message: "Xóa người dùng thành công" }`  
**Error:** `404` `Không tìm thấy người dùng để xóa`

---

# Products service

`src/services/products.service.ts` — default export of query/create/update
helpers. Queries populate `brand` and `category` and return lean objects
where noted.

## Types

**`ProductVariantInput`:** `sku` (required), optional `variant_name`,
`color`, `size`, `price`, `compare_at_price`, `stock`, `image`, `images`,
`attributes`.

**`ProductInput`:** `product_name`, `category`, `brand`, `model_year`
required at the type level; optional `price`, `discount`, `description`,
`slug`, `thumbnail`, `stock`, `is_active`, `variants`.

## Variant normalization

`normalizeVariant`:

- Trims strings; SKU is uppercased.
- `images` is a trimmed non-empty list; `image` falls back to `images[0]`.
- If there is an `image` but no `images`, `images` becomes `[image]`.
- `price` falls back to the product price (or `0`).
- `stock` defaults to `0`.
- Empty `attributes` becomes `{}`.

`ensureUniqueVariantSkus`:

- Throws if any SKU is empty, duplicated inside the same product, or already
  used on another product (`variants.sku`).
- On update, the current product `_id` is excluded from the uniqueness check.

Thrown values are plain `Error` (not `http-errors`), so status depends on
the error middleware (typically 500 unless mapped).

## `getAllProducts({ sku?, color?, size? })`

Optional filters:

- `sku` — exact match on `variants.sku` after trim + uppercase
- `color` / `size` — case-insensitive regex on the corresponding variant field

Sorted by `createdAt` descending. Returns lean documents with populated
brand and category.

## `getProductBySku(sku)`

One product whose variants contain that SKU (normalized). Lean + populate.
Returns `null` if none.

## `getVariantByProductAndVariantId(productId, variantId)`

Loads the product, finds a variant by `_id`. Returns
`{ product, variant }` or `null`.

## `getProductById(id)`

Lean + populate. Returns `null` if missing.

## `createProduct(payload)`

1. Requires a non-empty trimmed `product_name` (`Error`: `Tên sản phẩm là bắt buộc`).
2. Builds `slug` from `payload.slug` or `buildSlug(name)`
   (`src/helpers/buildSlug.helper.ts`). If the slug exists, appends `-1`,
   `-2`, …
3. Normalizes variants and checks SKU uniqueness.
4. `price`: payload value, else the minimum variant price, else `0`.
5. `stock`: payload value, else the sum of variant stocks.
6. `thumbnail`: payload value, else the first variant `image`.

Returns `product.toObject()`.

## `updateProduct(id, payload)`

Returns `null` if the product does not exist.

- If `product_name` is sent, name is trimmed and slug is rebuilt (unique
  among other products).
- If `variants` is an array, SKUs are re-normalized and uniqueness is
  checked. Missing `price` / `stock` / `thumbnail` on the payload are
  recomputed from variants as on create.

`findByIdAndUpdate` with `runValidators: true`. Returns the updated
plain object or `null`.

## `deleteProduct(id)`

Hard delete. Returns the deleted plain object or `null`.

---

# Categories service

`src/services/categories.service.ts` — static class `CategoriesService`.
Uses `buildSlug` from `src/helpers/slug.helpers.ts` (not
`buildSlug.helper.ts`). Throws `http-errors`.

Category fields: `name`, `slug`, `description?`, `icon?`, `parent?`,
`isActive`, `isDeleted`, `deletedAt`, timestamps.

**Note:** list/get/create/update **do not** filter `isDeleted: false`.
Unlike brands, delete is a **hard** delete.

## `createCategory(data)`

Slug is generated from `data.name`. Rejects if another category already has
that name or slug (`409` `Categories with this name or slug already exists`).

Spreads `data` onto the document and overwrites `slug`. `name` is assumed
present (`data.name!`).

## `getAllCategories()`

All categories, newest first. Populates `parent` with `name` and `slug`.

## `getCategoryById(id)`

Same populate. **Error:** `404` `Categories not found`.

## `updateCategory(id, data)`

**Error:** `404` if missing.

If `name` changes, regenerates `slug` and rejects another document with the
same name or slug (`409`). Then `Object.assign` + `save()`.

## `deleteCategory(id)`

**Error:** `404` if missing.

Sets `parent` to `null` on children that pointed at this category, then
hard-deletes the category. Return type is `void`.

---

# Brands service

`src/services/brands.service.ts` — static class `BrandService`. Input types
come from `src/validations/brands.validation.ts`.

Brand fields: `name`, `slug`, `description?`, `logoUrl?`, `isActive`,
`isDeleted`, `deletedAt`, timestamps.

Queries always use `isDeleted: false`. Invalid ObjectIds return `null`
instead of throwing.

## `getAll()`

All non-deleted brands, newest first.

## `getById(id)`

`null` if the id is invalid, missing, or soft-deleted.

## `create(data: BrandInput)`

`BrandInput` is `{ name, description? }`. Slug is `buildSlug(data.name)`
from `src/helpers/buildSlug.helper.ts`. Does not check slug uniqueness in
the service; the model has a unique index on `slug`.

Does not set `logoUrl` or `isActive` here (model defaults `isActive: true`).

## `update(id, data: UpdateBrandInput)`

Partial `{ name?, description? }` with at least one field (enforced in
validation, not in the service). Changing `name` regenerates `slug`.

`findOneAndUpdate` on `{ _id, isDeleted: false }` with `runValidators`.
Returns `null` for invalid id or missing/deleted brand.

## `delete(id)`

Soft delete: `isDeleted: true`, `deletedAt: now`. Returns the updated
document or `null`.

---

# Error style

| Service | Library | Typical HTTP |
| :--- | :--- | :--- |
| Auth, User, Categories | `http-errors` (`createError` / `createHttpError`) | Status on the error object |
| Products | `new Error(...)` | Depends on middleware |
| Brands | Returns `null`; unique index may throw Mongo errors | Controller must map `null` to 404 |

JWT signing is duplicated in auth and user login, including the same
fallback secret.
