// These tests reproduce current behavior; passing confirms the reported defect.
// No HTTP/database/provider calls and no application source edits.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import AdminArticlesPage from '@/pages/admin/articles';

const state = vi.hoisted(() => ({
  getArticle: vi.fn(), create: vi.fn(), categoryError: false,
  listeners: new Set<() => void>(),
  category: { _id: 'b'.repeat(24), name: 'Category fixture', slug: 'category-fixture', description: '', isActive: true, __v: 0 },
  article: { _id: 'a'.repeat(24), title: 'Stored article fixture', slug: 'stored-article', type: 'news', category: 'Category fixture', categoryId: 'b'.repeat(24), excerpt: 'Summary', content: 'Body', imageUrl: null, tags: [], authorName: 'Fixture', status: 'draft', publishAt: null, publishedAt: null, isFeatured: false, sortOrder: 0, viewCount: 0, seo: {}, __v: 0 },
}));
vi.mock('@/layout/admin/base-layout', () => ({ BaseLayout: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('@/features/articles/services/articles.service', () => ({ getArticle: (...args: unknown[]) => state.getArticle(...args) }));
vi.mock('@/features/articles/hooks/use-articles', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useArticles: () => ({ isPending: false, isError: false, isSuccess: true, isFetching: false, data: { data: [state.article], pagination: { totalPages: 1 } }, refetch: vi.fn() }),
    usePostCategories: () => {
      const isError = useSyncExternalStore(callback => { state.listeners.add(callback); return () => { state.listeners.delete(callback); }; }, () => state.categoryError);
      return { isPending: false, isError, data: [state.category], refetch: vi.fn() };
    },
    useArticleMutations: () => ({ create: { isPending: false, mutateAsync: state.create }, update: { isPending: false }, remove: { isPending: false } }),
  };
});
beforeEach(() => { state.getArticle.mockReset(); state.create.mockReset(); state.categoryError = false; });
function setup() {
  const router = createMemoryRouter([{ path: '/auth/articles', element: <AdminArticlesPage /> }], { initialEntries: ['/auth/articles'] });
  render(<RouterProvider router={router} />);
}

it('reproduces a late edit response replacing a new dirty article without discard confirmation', async () => {
  let resolve!: (article: typeof state.article) => void;
  state.getArticle.mockImplementation(() => new Promise(done => { resolve = done; }));
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Sửa', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài viết' }));
  fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Unsaved new article fixture' } });
  expect((screen.getByLabelText('Tiêu đề') as HTMLInputElement).value).toBe('Unsaved new article fixture');
  await act(async () => { resolve(state.article); });
  await waitFor(() => expect((screen.getByLabelText('Tiêu đề') as HTMLInputElement).value).toBe(state.article.title));
  expect(screen.queryByText('Bỏ các thay đổi chưa lưu?')).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});

it('reproduces an auxiliary category refetch error erasing the dirty article editor', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bài viết' }));
  fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'Unsaved draft before category error' } });
  act(() => { state.categoryError = true; state.listeners.forEach(callback => callback()); });
  await waitFor(() => expect(screen.queryByLabelText('Tiêu đề')).toBeNull());
  expect(screen.getByText('Không tải được danh mục.')).toBeTruthy();
  act(() => { state.categoryError = false; state.listeners.forEach(callback => callback()); });
  await waitFor(() => expect((screen.getByLabelText('Tiêu đề') as HTMLInputElement).value).toBe(''));
  expect(screen.queryByText('Bỏ các thay đổi chưa lưu?')).toBeNull();
  expect(state.create).not.toHaveBeenCalled();
});
