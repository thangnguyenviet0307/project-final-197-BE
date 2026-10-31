import { sumVariantStock } from "../utils/inventory.js";
import mongoose, { Schema } from "mongoose";

const productVariantSchema = new Schema(
  {
    sku: {
      type: String,
      required: [true, "SKU biến thể là bắt buộc"],
      trim: true,
      uppercase: true,
      match: [
        /^[A-Z0-9-]+$/,
        "SKU chỉ được chứa chữ cái, số và dấu gạch ngang",
      ],
    },
    variant_name: {
      type: String,
      trim: true,
      default: null,
      maxlength: [100, "Tên biến thể tối đa 100 ký tự"],
    },
    color: {
      type: String,
      trim: true,
      default: null,
      maxlength: [50, "Màu sắc tối đa 50 ký tự"],
    },
    size: {
      type: String,
      trim: true,
      default: null,
      maxlength: [50, "Kích thước tối đa 50 ký tự"],
    },
    price: {
      type: Number,
      required: [true, "Giá biến thể là bắt buộc"],
      min: [0, "Giá biến thể không được nhỏ hơn 0"],
    },
    compare_at_price: {
      type: Number,
      default: null,
      min: [0, "Giá so sánh không được nhỏ hơn 0"],
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, "Số lượng tồn kho không được nhỏ hơn 0"],
    },
    image: {
      type: String,
      default: null,
      maxlength: [255, "Ảnh biến thể tối đa 255 ký tự"],
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) =>
          value.every((item) => item.length <= 255),
        message: "Mỗi URL ảnh tối đa 255 ký tự",
      },
    },
    attributes: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    _id: true,
  },
);

const productImageSchema = new Schema({
  public_id: { type: String, required: true },
  secure_url: { type: String, required: true },
  width: Number, height: Number, format: String,
}, { _id: false });

const productSchema = new Schema(
  {
    seedBatch: { type: String, immutable: true, select: false, match: /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i },
    sku: { type: String, trim: true, uppercase: true, match: /^[A-Z0-9-]+$/, minlength: 3, maxlength: 64 },
    barcode: { type: String, trim: true, maxlength: 64, default: null },
    currency: { type: String, enum: ["VND"], default: "VND" },
    tags: { type: [String], default: [] },
    relatedNewsIds: { type: [{ type: Schema.Types.ObjectId, ref: "Article" }], default: [], validate: {
      validator: (ids: mongoose.Types.ObjectId[]) => ids.length <= 5 && new Set(ids.map(String)).size === ids.length,
      message: "Choose at most five different news articles",
    } },
    weight: { type: Number, min: 0, default: null },
    dimensions: { type: new Schema({ width: { type: Number, min: 0, required: true }, height: { type: Number, min: 0, required: true }, depth: { type: Number, min: 0, required: true } }, { _id: false }), default: null },
    warrantyInformation: { type: String, maxlength: 2000, default: null },
    shippingInformation: { type: String, maxlength: 2000, default: null },
    returnPolicy: { type: String, maxlength: 2000, default: null },
    minimumOrderQuantity: { type: Number, min: 1, default: 1, validate: Number.isSafeInteger },
    source: { type: String, enum: ["dummyjson"] },
    external_id: { type: String },
    sourceImages: { type: [String], default: [] },
    sourceCreatedAt: Date,
    sourceUpdatedAt: Date,
    sourceCurrency: { type: String, enum: ["USD"] },
    importExchangeRate: { type: Number, min: 0 },
    images: { type: [productImageSchema], default: [], validate: {
      validator: (images: unknown[]) => images.length <= 8, message: "A product can have up to 8 images",
    } },
    product_name: {
      type: String,
      required: true,
      trim: true,
      minLength: [3, "Tên sản phẩm ít nhất 3 ký tự"],
      maxLength: [255, "Tên sản phẩm tối đa 255 ký tự"],
    },
    price: {
      type: Number,
      default: 0,
      min: [0, "Giá sản phẩm không được nhỏ hơn 0"],
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, "Giảm giá không được nhỏ hơn 0"],
      max: [70, "Giảm giá không được vượt quá 70%"],
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Categories",
      required: true,
    },
    brand: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    model_year: {
      type: Number,
      default: null,
      min: [1900, "Năm model không hợp lệ"],
      max: [new Date().getFullYear() + 2, "Năm model không hợp lệ"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minLength: [3, "Slug ít nhất 3 ký tự"],
      maxLength: [255, "Slug tối đa 255 ký tự"],
    },
    thumbnail: {
      type: String,
      default: null,
      maxlength: [255, "Thumbnail tối đa 255 ký tự"],
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, "Số lượng tồn kho không được nhỏ hơn 0"],
    },
    on_sale: { type: Boolean, default: true },
    count_view: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    is_best_seller: { type: Boolean, default: false },
    is_new: { type: Boolean, default: false },
    is_hot: { type: Boolean, default: false },
    is_home: { type: Boolean, default: false },
    is_active: {
      type: Boolean,
      default: true,
    },
    variants: {
      type: [productVariantSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "products",
    optimisticConcurrency: true,
  },
);

productSchema.pre("validate", function () {
  if (!Number.isSafeInteger(this.stock)) this.invalidate("stock", "Stock must be a safe integer");
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const variant of this.variants) {
    if (ids.has(String(variant._id))) this.invalidate("variants", "Duplicate variant ID");
    if (skus.has(variant.sku)) this.invalidate("variants", "Duplicate variant SKU");
    ids.add(String(variant._id));
    skus.add(variant.sku);
    if (!Number.isSafeInteger(variant.stock)) this.invalidate("variants", "Variant stock must be a safe integer");
  }
  if (this.variants.length && this.stock !== sumVariantStock(this.variants)) {
    this.invalidate("stock", "Stock must equal the sum of variant stocks");
  }
});
productSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true });
productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: "string" } } });
productSchema.index({ source: 1, external_id: 1 }, { unique: true, partialFilterExpression: { source: { $type: "string" }, external_id: { $type: "string" } } });

const Product = mongoose.model("Product", productSchema);
export default Product;
