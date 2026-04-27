import { usePostHog } from 'posthog-react-native';

/** JSON-serialisable value compatible with PostHog's event property type. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Properties = Record<string, JsonValue>;

/**
 * Safe wrapper around PostHog. Silently no-ops when PostHog is not available
 * (e.g. user declined analytics or the provider is not mounted).
 */
export function useAnalytics() {
  let posthog: ReturnType<typeof usePostHog> | null = null;
  try {
    // usePostHog throws if called outside PostHogProvider
    posthog = usePostHog();
  } catch {
    // PostHog not available — all methods will no-op
  }

  return {
    capture: (event: string, properties?: Properties) => {
      posthog?.capture(event, properties);
    },
    identify: (userId: string, properties?: Properties) => {
      posthog?.identify(userId, properties);
    },
    reset: () => {
      posthog?.reset();
    },
    /** The raw PostHog instance, or null if unavailable. */
    posthog,
  };
}
