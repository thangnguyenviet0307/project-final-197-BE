export interface AiOwner {
  kind: 'guest' | 'customer';
  id: string;
}
export interface AiProduct {
  id: string;
  slug: string;
  name: string;
  price: number;
  available: boolean;
  thumbnail: string | null;
  brand: string;
  category: string;
  description: string;
  specifications: string;
}
export interface AiSource {
  key: string;
  title: string;
  href: string;
  text: string;
}
export interface AiEvent {
  type: string;
  requestId?: string;
  data?: unknown;
}
