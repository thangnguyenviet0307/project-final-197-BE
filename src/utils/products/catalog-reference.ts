import type { ClientSession } from 'mongoose';
import createHttpError from 'http-errors';
import { BrandModel } from '../../models/brands/brands.model.js';
import { Categories } from '../../models/categories/categories.model.js';

export async function assertActiveCatalog(
  brand: unknown,
  category: unknown,
  session?: ClientSession
) {
  const brandQuery = BrandModel.exists({
    _id: brand,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  const categoryQuery = Categories.exists({
    _id: category,
    isDeleted: { $ne: true },
    isActive: { $ne: false },
  });
  if (session) {
    brandQuery.session(session);
    categoryQuery.session(session);
  }
  if (!(await brandQuery))
    throw createHttpError(409, 'Brand is missing or inactive');
  if (!(await categoryQuery))
    throw createHttpError(409, 'Category is missing or inactive');
}

export async function assertAdditionalCategories(
  categories: string[],
  session: ClientSession
) {
  for (const id of categories) {
    if (
      !(await Categories.exists({
        _id: id,
        isDeleted: { $ne: true },
        isActive: { $ne: false },
      }).session(session))
    )
      throw createHttpError(409, 'Category is missing or inactive');
  }
}

export function categoryMembership(ids: unknown[]) {
  const values = ids.filter((value) => value != null).map(String);
  return {
    $or: [{ category: { $in: values } }, { categories: { $in: values } }],
  };
}

// Resolve the same visible descendant branch for storefront and AI candidates.
export async function expandPublicCategoryFilter(
  category?: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  if (!category) return undefined;
  signal?.throwIfAborted();
  const query = Categories.find({
    isActive: true,
    isDeleted: { $ne: true },
  }).select('_id parent');
  if (signal) query.setOptions({ signal, maxTimeMS: 5000 });
  const categories = await query.lean();
  signal?.throwIfAborted();
  const requested = new Set(category.split(',').map((id) => id.toLowerCase()));
  const selected = new Set(
    categories
      .filter((item) => requested.has(String(item._id)))
      .map((item) => String(item._id))
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of categories) {
      const id = String(item._id);
      if (
        item.parent &&
        selected.has(String(item.parent)) &&
        !selected.has(id)
      ) {
        selected.add(id);
        expanded = true;
      }
    }
  }
  return [...selected].join(',') || '000000000000000000000000';
}
