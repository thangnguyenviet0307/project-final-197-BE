import mongoose from "mongoose";

//create category schema
const categorySchema = new mongoose.Schema({
    category_name: {
        type: String,
        required: true,
        unique: true,
        trim: true, // loại bỏ khoảng trắng ở đầu và cuối chuỗi
        minLength: [2, 'Tên thương hiệu tối thiểu 2 ký tự'],
        maxLength: [50, 'Tên danh mục tối đa 50 ký tự']
    },
    description: {
        type: String,
        trim: true,
        maxLength: [500, 'Mô tả tối đa 500 ký tự'],
        default: null
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minLength: [2, 'Tên thương hiệu tối thiểu 2 ký tự'],
        maxLength: [50, 'Slug tối đa 50 ký tự']
    }
},{
    timestamps: true, // Tự động thêm createdAt và updatedAt
    collection: "categories", // Tên collection trong MongoDB, nếu ko thì nó sẽ lấy tên tự động là category theo tên model
});

//create category model
const Category = mongoose.model("Category", categorySchema);
export default Category;


