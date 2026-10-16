export interface IUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'staff';
  active: boolean;
  refreshToken?: string | null;
}