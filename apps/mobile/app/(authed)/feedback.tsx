import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';

type FeedbackType = 'feature_request' | 'bug_report';

interface FeedbackResponse {
  id: string;
  message: string;
}

export default function FeedbackScreen() {
  const c = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();

  const [selectedType, setSelectedType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [useCustomEmail, setUseCustomEmail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!selectedType || !title.trim() || !description.trim()) return;

    setSubmitting(true);

    try {
      const resolvedEmail =
        user?.email && !useCustomEmail ? user.email : email.trim() || null;

      await api<FeedbackResponse>('/feedback', {
        method: 'POST',
        json: {
          type: selectedType,
          title: title.trim(),
          description: description.trim(),
          email: resolvedEmail,
        },
      });

      setSubmittedEmail(resolvedEmail);
      setSuccess(true);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setSelectedType(null);
    setTitle('');
    setDescription('');
    setEmail(user?.email ?? '');
    setUseCustomEmail(false);
    setSuccess(false);
    setSubmittedEmail(null);
  };

  // -- Success state --
  if (success) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.container, { backgroundColor: c.background }]}
      >
        <View style={styles.successContainer}>
          <View
            style={[styles.successIcon, { backgroundColor: c.accentSoft }]}
          >
            <Text style={{ fontSize: 32 }}>{'\u2713'}</Text>
          </View>

          <Text style={[styles.successTitle, { color: c.text }]}>
            Thanks for your feedback!
          </Text>

          {submittedEmail ? (
            <Text style={[styles.successMessage, { color: c.textMuted }]}>
              We&apos;ll get back to you at{' '}
              <Text style={{ fontWeight: '600', color: c.text }}>
                {submittedEmail}
              </Text>
            </Text>
          ) : (
            <Text style={[styles.successMessage, { color: c.textMuted }]}>
              We read every submission, even anonymous ones.
            </Text>
          )}

          <View style={styles.successActions}>
            <Pressable
              onPress={handleReset}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: c.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: c.text }]}>
                Submit another
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: c.accent,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={styles.primaryButtonText}>Back to profile</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // -- Type selection --
  if (!selectedType) {
    return (
      <SafeAreaView
        edges={['bottom']}
        style={[styles.container, { backgroundColor: c.background }]}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.heading, { color: c.text }]}>
            Send us feedback
          </Text>
          <Text style={[styles.subheading, { color: c.textMuted }]}>
            Help us make MyEtAl better for your research.
          </Text>

          <View style={styles.cardsContainer}>
            <Pressable
              onPress={() => setSelectedType('feature_request')}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.cardIcon}>{'\u{1f4a1}'}</Text>
              <Text style={[styles.cardTitle, { color: c.text }]}>
                Request a feature
              </Text>
              <Text style={[styles.cardSubtitle, { color: c.textMuted }]}>
                Tell us what would make MyEtAl better for your research
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setSelectedType('bug_report')}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: c.surface,
                  borderColor: c.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text style={styles.cardIcon}>{'\u{1f41b}'}</Text>
              <Text style={[styles.cardTitle, { color: c.text }]}>
                Report an issue
              </Text>
              <Text style={[styles.cardSubtitle, { color: c.textMuted }]}>
                Something broken or not working as expected?
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // -- Form --
  const typeLabel =
    selectedType === 'feature_request' ? 'Feature request' : 'Bug report';
  const typeIcon =
    selectedType === 'feature_request' ? '\u{1f4a1}' : '\u{1f41b}';
  const titlePlaceholder =
    selectedType === 'feature_request'
      ? 'What would you like?'
      : 'What went wrong?';
  const descPlaceholder =
    selectedType === 'feature_request'
      ? 'Describe the feature and how it would help...'
      : 'Steps to reproduce, what you expected, and what happened...';

  const canSubmit = !submitting && title.trim().length > 0 && description.trim().length > 0;

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: c.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Type badge */}
          <View style={styles.badgeRow}>
            <View
              style={[styles.badge, { backgroundColor: c.accentSoft }]}
            >
              <Text style={styles.badgeText}>
                <Text>{typeIcon} </Text>
                <Text style={{ color: c.accent }}>{typeLabel}</Text>
              </Text>
            </View>
            <Pressable onPress={() => setSelectedType(null)}>
              <Text style={[styles.changeLink, { color: c.textMuted }]}>
                Change
              </Text>
            </Pressable>
          </View>

          {/* Title */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: c.text }]}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={titlePlaceholder}
              placeholderTextColor={c.textSubtle}
              maxLength={200}
              style={[
                styles.input,
                {
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.surface,
                },
              ]}
            />
            <Text style={[styles.charCount, { color: c.textSubtle }]}>
              {title.length}/200
            </Text>
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={[styles.label, { color: c.text }]}>Description</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={descPlaceholder}
              placeholderTextColor={c.textSubtle}
              maxLength={2000}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              style={[
                styles.textArea,
                {
                  color: c.text,
                  borderColor: c.border,
                  backgroundColor: c.surface,
                },
              ]}
            />
            <Text style={[styles.charCount, { color: c.textSubtle }]}>
              {description.length}/2000
            </Text>
          </View>

          {/* Email */}
          <View style={styles.field}>
            {user?.email && !useCustomEmail ? (
              <View
                style={[
                  styles.emailPreview,
                  { backgroundColor: c.accentSoft },
                ]}
              >
                <Text style={[styles.emailPreviewText, { color: c.text }]}>
                  {'\u2713'} We&apos;ll reply to{' '}
                  <Text style={{ fontWeight: '600' }}>{user.email}</Text>
                </Text>
                <Pressable onPress={() => setUseCustomEmail(true)}>
                  <Text
                    style={[styles.emailChangeLink, { color: c.textMuted }]}
                  >
                    Change
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <View style={styles.emailLabelRow}>
                  <Text style={[styles.label, { color: c.text }]}>
                    Email for follow-up
                  </Text>
                  {user?.email && (
                    <Pressable
                      onPress={() => {
                        setUseCustomEmail(false);
                        setEmail(user.email ?? '');
                      }}
                    >
                      <Text
                        style={[
                          styles.emailChangeLink,
                          { color: c.textMuted },
                        ]}
                      >
                        Use {user.email}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  placeholderTextColor={c.textSubtle}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={320}
                  style={[
                    styles.input,
                    {
                      color: c.text,
                      borderColor: c.border,
                      backgroundColor: c.surface,
                    },
                  ]}
                />
              </>
            )}
          </View>

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submitButton,
              {
                backgroundColor: c.accent,
                opacity: canSubmit ? (pressed ? 0.8 : 1) : 0.5,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit feedback</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  scrollContent: { paddingTop: Spacing.lg, paddingBottom: Spacing.xl },

  heading: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  subheading: { fontSize: 15, marginTop: Spacing.xs },

  cardsContainer: { marginTop: Spacing.lg, gap: Spacing.md },
  card: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  cardIcon: { fontSize: 28 },
  cardTitle: { fontSize: 18, fontWeight: '600', marginTop: Spacing.sm },
  cardSubtitle: { fontSize: 14, marginTop: Spacing.xs },

  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  badgeText: { fontSize: 14, fontWeight: '500' },
  changeLink: { fontSize: 14, textDecorationLine: 'underline' },

  field: { marginBottom: Spacing.lg },
  label: { fontSize: 14, fontWeight: '500', marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 120,
  },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: 4 },

  emailPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  emailPreviewText: { fontSize: 14, flex: 1 },
  emailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  emailChangeLink: { fontSize: 12, textDecorationLine: 'underline' },

  submitButton: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 22, fontWeight: '700', marginTop: Spacing.lg },
  successMessage: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  successActions: {
    marginTop: Spacing.xl,
    gap: Spacing.md,
    width: '100%',
  },
  secondaryButton: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 16, fontWeight: '500' },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
