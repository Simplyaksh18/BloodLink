import React from 'react';
import { KeyboardAvoidingView, Platform, ViewStyle } from 'react-native';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * Drop-in wrapper that keeps focused inputs above the software keyboard.
 * Usage: wrap the content area (inside SafeAreaView, after fixed headers).
 * iOS  → "padding" shifts the entire view up by keyboard height.
 * Android → "height" shrinks the view so the keyboard doesn't overlap.
 */
export function KeyboardSafeScreen({ children, style }: Props) {
  console.log('[KeyboardSafe] applied screen: request');
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
