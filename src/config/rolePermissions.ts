import { Permission } from '../types/permissions.type.js';

export type Role = 'admin' | 'staff';

const rolePermissions: Record<Role, Permission[]> = {
  admin: [
    // Orders
    Permission.OrderView,
    Permission.OrderViewAll,
    Permission.OrderCreate,
    Permission.OrderUpdateStatus,
    Permission.OrderAssign,
    Permission.OrderDelete,
    // Products
    Permission.ProductView,
    Permission.ProductCreate,
    Permission.ProductUpdate,
    Permission.ProductDelete,
    // Categories
    Permission.CategoryView,
    Permission.CategoryCreate,
    Permission.CategoryUpdate,
    Permission.CategoryDelete,
    // Brands
    Permission.BrandView,
    Permission.BrandCreate,
    Permission.BrandUpdate,
    Permission.BrandDelete,
    // Customers
    Permission.CustomerView,
    Permission.CustomerCreate,
    Permission.CustomerUpdate,
    Permission.CustomerDelete,
    // Users
    Permission.UserView,
    Permission.UserCreate,
    Permission.UserUpdate,
    Permission.UserDelete,
  ],
  staff: [
    // Orders - read only; own and unassigned orders
    Permission.OrderView,
    // Products - chỉ xem
    Permission.ProductView,
    // Categories - chỉ xem
    Permission.CategoryView,
    // Brands - chỉ xem
    Permission.BrandView,
    // Customers - xem và tạo
    Permission.CustomerView,
    Permission.CustomerCreate,
  ],
};

export function hasPermission(role: string, permission: Permission): boolean {
  const permissions = rolePermissions[role as Role] || [];
  return permissions.includes(permission);
}

export function getPermissionsForRole(role: string): Permission[] {
  return rolePermissions[role as Role] || [];
}