import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { COLORS, SPACING, RADIUS, FONT_SIZES } from '../constants/theme';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

const variantStyles: Record<Variant, { container: ViewStyle; text: TextStyle }> = {
  primary: {
    container: { backgroundColor: COLORS.primary },
    text: { color: COLORS.white },
  },
  secondary: {
    container: { backgroundColor: COLORS.primarySurface },
    text: { color: COLORS.primary },
  },
  outline: {
    container: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.primary },
    text: { color: COLORS.primary },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: COLORS.primary },
  },
  danger: {
    container: { backgroundColor: COLORS.error },
    text: { color: COLORS.white },
  },
};

const sizeStyles: Record<Size, { container: ViewStyle; text: TextStyle }> = {
  sm: { container: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md }, text: { fontSize: FONT_SIZES.sm } },
  md: { container: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg }, text: { fontSize: FONT_SIZES.base } },
  lg: { container: { paddingVertical: SPACING.base, paddingHorizontal: SPACING.xl }, text: { fontSize: FONT_SIZES.md } },
};

export const CustomButton: React.FC<Props> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  style,
  textStyle,
  fullWidth = true,
}) => {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={[
        styles.base,
        variantStyles[variant].container,
        sizeStyles[size].container,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' || variant === 'danger' ? COLORS.white : COLORS.primary}
        />
      ) : (
        <Text style={[styles.text, variantStyles[variant].text, sizeStyles[size].text, textStyle]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
