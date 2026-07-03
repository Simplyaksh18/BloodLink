import React from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ViewStyle,
  StyleProp,
} from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Set to false when the form is short enough that scrolling isn't needed */
  scrollable?: boolean;
}

/**
 * Drop-in wrapper for any input-heavy screen or modal.
 * Keeps the focused input above the keyboard on both iOS and Android
 * without hardcoded pixel offsets.
 *
 * Usage:
 *   <KeyboardSafeLayout contentContainerStyle={{ padding: 20 }}>
 *     <TextInput ... />
 *     <Button ... />
 *   </KeyboardSafeLayout>
 */
export function KeyboardSafeLayout({ children, style, contentContainerStyle, scrollable = true }: Props) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {scrollable ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[{ flexGrow: 1 }, contentContainerStyle]}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </KeyboardAvoidingView>
  );
}
