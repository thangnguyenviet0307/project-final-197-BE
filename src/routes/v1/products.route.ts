import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  sku: string;
  categoryId: Types.ObjectId;
  brandId: Types.ObjectId;
  price: number;
  discountPrice?: number;
  stock: number;
  images: string[];
  description?: string;
  status: 'draft' | 'published' | 'out_of_stock';
  isDeleted: boolean; // Soft delete
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'Tên sản phẩm là bắt buộc'],
      trim: true,
      minlength: 5,
      maxlength: 200,
    },
    sku: {
      type: String,
      required: [true, 'Mã SKU là bắt buộc'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Danh mục là bắt buộc'],
      index: true,
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: 'Brand',
      required: [true, 'Thương hiệu là bắt buộc'],
      index: true,
    },
    price: {
      type: Number,
      required: [true, 'Giá niêm yết là bắt buộc'],
      min: [0, 'Giá tiền không được nhỏ hơn 0'],
    },
    discountPrice: {
      type: Number,
      validate: {
        validator: function (this: IProduct, value: number) {
          return !value || value < this.price;
        },
        message: 'Giá khuyến mãi phải nhỏ hơn giá gốc',
      },
    },
    stock: {
      type: Number,
      required: [true, 'Số lượng tồn kho là bắt buộc'],
      min: [0, 'Tồn kho không được nhỏ hơn 0'],
      default: 0,
    },
    images: {
      type: [String],
      validate: {
        validator: (val: string[]) => val && val.length > 0,
        message: 'Cần tối thiểu 1 ảnh sản phẩm',
      },
    },
    description: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'out_of_stock'],
      default: 'draft',
      index: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

export const Product = mongoose.model<IProduct>('Product', ProductSchema);