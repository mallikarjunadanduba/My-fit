import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FeedbackProvider } from '../../src/client/components/common/Feedback';
import { AddFoodDialog } from '../../src/client/features/diary/AddFoodDialog';

const oats = {
  id: 'f1',
  name: 'Rolled oats',
  brand: null,
  preparation: null,
  notes: null,
  servingSize: 40,
  servingUnit: 'G',
  servingLabel: null,
  calories: 150,
  protein: 5,
  carbs: 27,
  fat: 3,
  fiber: 4,
  isEstimate: true,
  source: 'CUSTOM',
  isFavorite: true,
  imageMediaId: null,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  categories: [],
};

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  getPaged: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../src/client/services/api', () => ({ api: apiMock }));
vi.mock('../../src/client/features/auth/AuthContext', () => ({ useAuth: () => ({ timezone: 'Asia/Kolkata' }) }));

afterEach(cleanup);

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.getPaged.mockReset();
  apiMock.post.mockReset();
  apiMock.get.mockImplementation(async (url: string) => {
    if (url === '/meals/slots') return [{ id: 's1', key: 'BREAKFAST', name: 'Breakfast', defaultTime: '08:00', sortOrder: 0, archivedAt: null }];
    if (url === '/foods/categories') return [];
    throw new Error(`unexpected ${url}`);
  });
  apiMock.getPaged.mockResolvedValue({ data: [oats], meta: { page: 1, pageSize: 40, total: 1, totalPages: 1 } });
});

describe('<AddFoodDialog />', () => {
  it('previews nutrition for the chosen amount, limits units and saves a diary entry', async () => {
    const onSaved = vi.fn();
    apiMock.post.mockResolvedValue({ id: 'e1', foodName: 'Rolled oats' });
    render(
      <FeedbackProvider>
        <AddFoodDialog open onClose={() => undefined} date="2026-03-02" defaultSlotId="s1" onSaved={onSaved} />
      </FeedbackProvider>,
    );

    fireEvent.click(await screen.findByText('Rolled oats'));
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    const qty = screen.getByLabelText('Quantity');
    fireEvent.change(qty, { target: { value: '60' } });
    await waitFor(() => expect(screen.getByText('225 kcal')).toBeInTheDocument());

    // Only grams and servings are offered for a gram-based food.
    fireEvent.mouseDown(screen.getByLabelText('Unit'));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual(['g', 'serving']);
    fireEvent.click(within(listbox).getByText('g'));

    fireEvent.click(screen.getByRole('button', { name: 'Add to diary' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(apiMock.post).toHaveBeenCalledWith(
      '/food-diary',
      expect.objectContaining({ date: '2026-03-02', slotId: 's1', foodId: 'f1', quantity: 60, unit: 'G' }),
    );
  });
});
