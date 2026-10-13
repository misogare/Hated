import { router, type Href } from 'expo-router';

/**
 * Back, when there is somewhere to go back to; otherwise to `fallback`.
 *
 * A screen opened by a redirect (onboarding resuming at a step), a link, or a
 * browser refresh has nothing behind it, and `router.back()` would do nothing
 * but log "The action 'GO_BACK' was not handled by any navigator".
 */
export function goBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
