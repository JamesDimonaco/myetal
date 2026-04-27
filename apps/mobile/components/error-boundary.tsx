import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary that captures unhandled exceptions.
 * If PostHog is available, it tries to report the error.
 * Renders a friendly recovery screen with a Retry button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Try to capture the error with PostHog if available.
    // We use a dynamic import to avoid depending on the provider context
    // (this class component cannot use hooks).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PostHog } = require('posthog-react-native') as {
        PostHog: { captureException?: (e: Error) => void } | undefined;
      };
      if (PostHog && typeof PostHog.captureException === 'function') {
        PostHog.captureException(error);
      }
    } catch {
      // PostHog unavailable — that's fine
    }

    if (__DEV__) {
      console.error('ErrorBoundary caught:', error, info.componentStack);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return <FallbackScreen onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

function FallbackScreen({ onRetry }: { onRetry: () => void }) {
  // Use light theme as a safe default since we can't use hooks in the
  // error path reliably.
  const c = Colors.light;

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <Text style={[styles.emoji]}>{'  \uD83D\uDCC4'}</Text>
      <Text style={[styles.title, { color: c.text }]}>
        Something went wrong
      </Text>
      <Text style={[styles.body, { color: c.textMuted }]}>
        An unexpected error occurred. Please try again.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: c.text, opacity: pressed ? 0.7 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={[styles.buttonText, { color: c.background }]}>
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  emoji: {
    fontSize: 48,
    marginBottom: Spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
