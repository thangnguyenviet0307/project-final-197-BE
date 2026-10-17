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

const productSchema = new Schema(
  {
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
      required: true,
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

productSchema.index({ "variants.sku": 1 }, { unique: true, sparse: true });

const Product = mongoose.model("Product", productSchema);
export default Product;
