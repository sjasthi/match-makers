import type { Post, TasteSummary } from '@match-makers/shared';
import {
  fetchPhotoFeed,
  fetchTasteSummary,
  reactToPost,
  undoPostReaction,
} from '@/services/posts';
import { useFeedStore } from './feedStore';
import {
  cancelPendingSummaryRefresh,
  SUMMARY_SETTLE_MS,
  usePhotoFeedStore,
} from './photoFeedStore';

jest.mock('@/services/posts', () => ({
  fetchPhotoFeed: jest.fn(),
  fetchTasteSummary: jest.fn(),
  reactToPost: jest.fn(),
  undoPostReaction: jest.fn(),
}));

const mockReactToPost = jest.mocked(reactToPost);
const mockUndoPostReaction = jest.mocked(undoPostReaction);
const mockFetchTasteSummary = jest.mocked(fetchTasteSummary);
const mockFetchPhotoFeed = jest.mocked(fetchPhotoFeed);

const POST: Post = {
  id: 'post-1',
  imageUri: 'test://post-1',
  tags: ['cats'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const EMPTY_SUMMARY: TasteSummary = { likes: 0, dislikes: 0, tags: [], closest: [] };
const loadFeed = useFeedStore.getState().load;

beforeEach(() => {
  jest.useFakeTimers();
  usePhotoFeedStore.getState().reset();
  useFeedStore.getState().reset();
  usePhotoFeedStore.setState({ posts: [POST], summary: EMPTY_SUMMARY, state: 'success' });
  mockReactToPost.mockReset().mockResolvedValue({
    id: 'reaction-1',
    userId: 'viewer-1',
    postId: POST.id,
    action: 'like',
    createdAt: POST.createdAt,
  });
  mockUndoPostReaction.mockReset().mockResolvedValue(true);
  mockFetchTasteSummary.mockReset().mockResolvedValue(EMPTY_SUMMARY);
  mockFetchPhotoFeed.mockReset();
});

afterEach(() => {
  cancelPendingSummaryRefresh();
  usePhotoFeedStore.getState().reset();
  useFeedStore.setState({ load: loadFeed });
  useFeedStore.getState().reset();
  jest.useRealTimers();
});

describe('a reaction refreshes the stored match deck', () => {
  it('reloads the deck after a like has settled', async () => {
    const refreshDeck = jest.fn().mockResolvedValue(undefined);
    useFeedStore.setState({ load: refreshDeck });

    expect(usePhotoFeedStore.getState().posts).toEqual([POST]);
    const reaction = usePhotoFeedStore.getState().react(POST.id, 'like');
    expect(mockReactToPost).toHaveBeenCalledWith(POST.id, 'like');
    await reaction;
    expect(refreshDeck).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(SUMMARY_SETTLE_MS);

    expect(mockReactToPost).toHaveBeenCalledWith(POST.id, 'like');
    expect(mockFetchTasteSummary).toHaveBeenCalledTimes(1);
    expect(refreshDeck).toHaveBeenCalledWith({ refresh: true });
  });

  it('reloads the deck after an undo has settled', async () => {
    const refreshDeck = jest.fn().mockResolvedValue(undefined);
    useFeedStore.setState({ load: refreshDeck });
    usePhotoFeedStore.setState({ reactions: { [POST.id]: 'like' } });

    await usePhotoFeedStore.getState().react(POST.id, 'like');
    await jest.advanceTimersByTimeAsync(SUMMARY_SETTLE_MS);

    expect(mockUndoPostReaction).toHaveBeenCalledWith(POST.id);
    expect(refreshDeck).toHaveBeenCalledWith({ refresh: true });
  });
});
