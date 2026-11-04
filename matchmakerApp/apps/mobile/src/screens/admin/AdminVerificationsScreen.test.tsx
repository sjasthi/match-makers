import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AdminVerificationsScreen } from '@/screens/admin/AdminVerificationsScreen';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { setActiveAuthMode } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';

const DEMO_IMAGE = 'data:image/jpeg;base64,ZmFrZS1waG90bw==';

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null, authMode: 'mock' });
  await setActiveAuthMode('mock');
  await mockDb.reset();
});

afterEach(async () => {
  await setActiveAuthMode('mock');
});

describe('AdminVerificationsScreen', () => {
  it('shows a pending photo and awards the badge only after Accept', async () => {
    const applicant = new MockAuthAdapter();
    const registered = await applicant.register({
      email: 'verification.applicant@example.com',
      password: 'Str0ngPass',
      name: 'Verification Applicant',
      dateOfBirth: '1994-02-04',
      gender: 'female' as never,
    });
    await applicant.submitVerification(DEMO_IMAGE, 'image/jpeg');
    await applicant.logout();

    const admin = new MockAuthAdapter();
    await admin.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    useAuthStore.setState({ state: 'authenticated', user: await admin.getCurrentUser() });

    render(<AdminVerificationsScreen />);

    expect(await screen.findByText('Verification Applicant')).toBeTruthy();
    expect(screen.getByText('verification.applicant@example.com')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(async () => {
      expect(await mockDb.getPendingVerificationSubmissions()).toHaveLength(0);
    });
    expect(await screen.findByText('No pending submissions')).toBeTruthy();
    expect((await mockDb.findUserById(registered.user.id))?.isVerified).toBe(true);
  });

  it('declines a submission without awarding the badge', async () => {
    const applicant = new MockAuthAdapter();
    const registered = await applicant.register({
      email: 'declined.applicant@example.com',
      password: 'Str0ngPass',
      name: 'Declined Applicant',
      dateOfBirth: '1994-02-04',
      gender: 'female' as never,
    });
    await applicant.submitVerification(DEMO_IMAGE, 'image/jpeg');
    await applicant.logout();

    const admin = new MockAuthAdapter();
    await admin.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    useAuthStore.setState({ state: 'authenticated', user: await admin.getCurrentUser() });

    render(<AdminVerificationsScreen />);

    expect(await screen.findByText('Declined Applicant')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(async () => {
      expect(await mockDb.getPendingVerificationSubmissions()).toHaveLength(0);
    });
    expect(await screen.findByText('No pending submissions')).toBeTruthy();
    expect((await mockDb.findUserById(registered.user.id))?.isVerified).toBe(false);
    expect((await mockDb.getLatestVerificationSubmission(registered.user.id))?.status).toBe(
      'rejected'
    );
  });
});
