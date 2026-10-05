import { Redirect } from 'expo-router';

import { useSession } from '@/session';

/** The first signed-in screen: resume onboarding where it was left, or go home. */
export default function Start() {
  const { account } = useSession();
  if (account?.onboarding.profile !== true) return <Redirect href="/onboarding/about" />;
  if (!account.onboarding.answers) return <Redirect href="/onboarding/questions" />;
  return <Redirect href="/home" />;
}
