import { Permission } from '../types/permissions.type.js';

export type Role = 'super_admin' | 'admin' | 'staff';

const rolePermissions: Record<Role, Permission[]> = {
  super_admin: Object.values(Permission),
  admin: Object.values(Permission).filter(permission => permission !== Permission.OwnershipTransfer && permission !== Permission.UserManageAdmins),
  staff: [
    // Staff read all history and operate orders assigned to themselves.
    Permission.OrderView,
    Permission.OrderViewAll,
    Permission.OrderCreate,
    Permission.OrderStart,
    Permission.OrderUpdateStatus,
    Permission.OrderUpdateDates,
    Permission.OrderNote,
    // Inventory changes use a strict endpoint; catalog/price writes stay Admin-only.
    Permission.ProductView,
    Permission.ProductInventory,
    Permission.CategoryView,
    Permission.BrandView,
    Permission.CustomerView,
  ],
};

export function hasPermission(role: string, permission: Permission): boolean {
  return getPermissionsForRole(role).includes(permission);
}

export function getPermissionsForRole(role: string): Permission[] {
  if (role !== 'super_admin' && role !== 'admin' && role !== 'staff') return [];
  return [...rolePermissions[role]];
}
