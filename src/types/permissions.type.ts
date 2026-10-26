export enum Permission {
  // Order permissions
  OrderView = 'orders:view',
  OrderStart = 'orders:start',
  OrderUpdateDates = 'orders:update-dates',
  OrderViewAll = 'orders:view-all',
  OrderCreate = 'orders:create',
  OrderUpdateStatus = 'orders:update-status',
  OrderAssign = 'orders:assign',
  OrderNote = 'orders:note',
  OrderDelete = 'orders:delete',

  // Product permissions
  ProductView = 'products:view',
  ProductCreate = 'products:create',
  ProductUpdate = 'products:update',
  ProductInventory = 'products:inventory',
  ProductDelete = 'products:delete',

  // Category permissions
  CategoryView = 'categories:view',
  CategoryCreate = 'categories:create',
  CategoryUpdate = 'categories:update',
  CategoryDelete = 'categories:delete',

  // Brand permissions
  BrandView = 'brands:view',
  BrandCreate = 'brands:create',
  BrandUpdate = 'brands:update',
  BrandDelete = 'brands:delete',

  // Customer permissions
  CustomerView = 'customers:view',
  CustomerCreate = 'customers:create',
  CustomerUpdate = 'customers:update',
  CustomerDelete = 'customers:delete',

  // User permissions
  UserView = 'users:view',
  UserCreate = 'users:create',
  UserUpdate = 'users:update',
  UserDelete = 'users:delete',
}

export type PermissionKey = keyof typeof Permission;