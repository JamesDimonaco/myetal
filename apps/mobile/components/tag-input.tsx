/**
 * Tag input — chips + freeform text + autocomplete dropdown.
 *
 * Mirrors the web equivalent (apps/web/src/components/tag-input.tsx) with
 * platform-native primitives: chips are <Pressable>s, suggestions render in a
 * <FlatList> that floats below the <TextInput>. Backspace-on-empty pops the
 * last chip (web parity). Comma or onSubmitEditing commits the current draft.
 *
 * Canonicalisation matches the backend: lowercased + trimmed + spaces →
 * hyphens. The server is authoritative; this is a UX nicety so chips look
 * right pre-save.
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputKeyPressEventData,
  View,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { api } from '@/lib/api';
import type { Tag } from '@/types/share';

interface TagInputProps {
  value: string[];
  onChange: (slugs: string[]) => void;
  max?: number;
}

/** Mirror of backend canonicalisation. Lowercase, trim, spaces → hyphens. */
function canonicalise(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    // strip anything that isn't alphanumeric / hyphen
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function TagInput({ value, onChange, max = 5 }: TagInputProps) {
  const c = Colors[useColorScheme() ?? 'light'];

  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atMax = value.length >= max;

  // Fetch autocomplete suggestions (debounced 200ms). Empty draft → popular.
  useEffect(() => {
    if (!focused) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = draft.trim();
    debounceRef.current = setTimeout(async () => {
      try {
        const path = q
          ? `/public/tags?q=${encodeURIComponent(q)}&limit=10`
          : '/public/tags/popular?limit=10';
        const data = await api<Tag[]>(path, { auth: null });
        setSuggestions(Array.isArray(data) ? data : []);
      } catch {
        // Network blip — silent. The chips still work without autocomplete.
        setSuggestions([]);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, focused]);

  const commit = (raw: string) => {
    const slug = canonicalise(raw);
    if (!slug) {
      setDraft('');
      return;
    }
    if (value.includes(slug)) {
      setDraft('');
      return;
    }
    if (value.length >= max) {
      setDraft('');
      return;
    }
    onChange([...value, slug]);
    setDraft('');
  };

  const remove = (slug: string) => {
    onChange(value.filter((s) => s !== slug));
  };

  const handleChangeText = (text: string) => {
    // Comma commits (web parity). Process if there's a trailing comma in input.
    if (text.includes(',')) {
      const parts = text.split(',');
      const last = parts.pop() ?? '';
      for (const part of parts) {
        commit(part);
      }
      setDraft(last);
      return;
    }
    setDraft(text);
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    // TODO(IME): React Native doesn't expose `isComposing` cleanly on
    // TextInput key events (web parity gap with the web tag-input — see
    // apps/web/src/components/tag-input.tsx). Mid-composition Backspace
    // on Japanese/Chinese/Korean keyboards may pop a chip when the user
    // intended to delete the last unconfirmed character. Tracked.
    if (e.nativeEvent.key === 'Backspace' && draft === '' && value.length > 0) {
      // Backspace on empty — pop the last chip.
      onChange(value.slice(0, -1));
    }
  };

  const visibleSuggestions = suggestions
    .filter((s) => !value.includes(s.slug))
    .slice(0, 10);

  return (
    <View style={styles.wrap}>
      {/* Chip row + input row. The TextInput sits inline with chips so the
          flow looks like a tags editor rather than two separate fields. */}
      <View
        style={[
          styles.fieldRow,
          {
            borderColor: focused ? c.text : c.border,
            backgroundColor: c.surface,
          },
        ]}
      >
        {value.map((slug) => (
          <Pressable
            key={slug}
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${slug}`}
            onPress={() => remove(slug)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: c.accentSoft,
                borderColor: c.accent,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.chipText, { color: c.accentText }]}>
              {slug}
            </Text>
            <Ionicons name="close" size={12} color="#B00020" />
          </Pressable>
        ))}

        {!atMax ? (
          <TextInput
            value={draft}
            onChangeText={handleChangeText}
            onKeyPress={handleKeyPress}
            onSubmitEditing={() => commit(draft)}
            onFocus={() => setFocused(true)}
            // Defer blur so the suggestion onPress fires before we tear down
            // the dropdown. Without this, tapping a suggestion just dismisses
            // the keyboard.
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder={value.length === 0 ? 'Add tags…' : ''}
            placeholderTextColor={c.textSubtle}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
            blurOnSubmit={false}
            accessibilityHint="Type a tag, then press comma or return to add it. Backspace removes the last tag."
            style={[styles.input, { color: c.text }]}
          />
        ) : null}
      </View>

      {atMax ? (
        <Text style={[styles.maxHint, { color: c.textSubtle }]}>5 max</Text>
      ) : null}

      {/* Suggestions dropdown. Bounded ~150px high with scroll. We render a
          ScrollView-equivalent via a plain View loop because nesting a
          FlatList inside a parent ScrollView (the share editor) would
          warn — the per-item count is small (≤10) so a simple map is fine. */}
      {focused && visibleSuggestions.length > 0 ? (
        <View
          style={[
            styles.suggestList,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {visibleSuggestions.map((s) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={`Add tag ${s.slug}`}
              onPress={() => commit(s.slug)}
              style={({ pressed }) => [
                styles.suggestRow,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.suggestLabel, { color: c.text }]}>
                {s.label}
              </Text>
              {typeof s.usage_count === 'number' && s.usage_count > 0 ? (
                <Text
                  style={[styles.suggestCount, { color: c.textSubtle }]}
                >
                  {s.usage_count}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  fieldRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 12, fontWeight: '600' },
  input: {
    flexGrow: 1,
    flexBasis: 100,
    minWidth: 80,
    fontSize: 14,
    paddingVertical: 4,
  },
  maxHint: { fontSize: 11, marginTop: 2 },
  suggestList: {
    marginTop: 4,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 150,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  suggestLabel: { fontSize: 14 },
  suggestCount: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
