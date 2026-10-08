export interface BrandInput {
  name: string;
  description?: string;
}

export function validateBrand(data: unknown): BrandInput {
  // 1. Kiểm tra dữ liệu đầu vào
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data)
  ) {
    throw new Error('Invalid brand data');
  }

  const body = data as Record<string, unknown>;

  // 2. Kiểm tra tên thương hiệu
  const name = body['name'];

  if (
    typeof name !== 'string' ||
    name.trim().length === 0
  ) {
    throw new Error('Brand name is required');
  }

  if (name.trim().length > 100) {
    throw new Error(
      'Brand name must not exceed 100 characters'
    );
  }

  // 3. Kiểm tra mô tả thương hiệu
  const description = body['description'];

  if (
    description !== undefined &&
    typeof description !== 'string'
  ) {
    throw new Error('Description must be a string');
  }

  // 4. Chuẩn hóa dữ liệu
  const result: BrandInput = {
    name: name.trim(),
  };

  if (typeof description === 'string') {
    result.description = description.trim();
  }

  return result;
}