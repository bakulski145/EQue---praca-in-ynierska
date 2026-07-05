import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class EQueColors {
  EQueColors._();

  static const teal50 = Color(0xFFECFDFA);
  static const teal100 = Color(0xFFCFF8F1);
  static const teal200 = Color(0xFF9CEEE2);
  static const teal400 = Color(0xFF25C7B7);
  static const teal500 = Color(0xFF0FB5AB);
  static const teal600 = Color(0xFF0E9B92);
  static const teal700 = Color(0xFF0C7B74);

  static const slate0 = Color(0xFFFFFFFF);
  static const slate50 = Color(0xFFF6F8F9);
  static const slate100 = Color(0xFFEDF1F3);
  static const slate200 = Color(0xFFDDE4E8);
  static const slate300 = Color(0xFFC4CED4);
  static const slate400 = Color(0xFF94A3AC);
  static const slate500 = Color(0xFF677782);
  static const slate600 = Color(0xFF4C5961);
  static const slate700 = Color(0xFF364148);
  static const slate800 = Color(0xFF232B30);
  static const slate900 = Color(0xFF151B1F);

  static const amber50 = Color(0xFFFFF8EB);
  static const amber100 = Color(0xFFFDEDC8);
  static const amber500 = Color(0xFFF2A60C);
  static const amber600 = Color(0xFFD98906);
  static const amber700 = Color(0xFFA9650A);

  static const green50 = Color(0xFFECFDF3);
  static const green100 = Color(0xFFD1FADF);
  static const green500 = Color(0xFF16A34A);
  static const green600 = Color(0xFF128A3E);
  static const green700 = Color(0xFF0F6E33);

  static const red50 = Color(0xFFFEF2F2);
  static const red100 = Color(0xFFFEE2E2);
  static const red500 = Color(0xFFE5484D);
  static const red600 = Color(0xFFCE363B);
  static const red700 = Color(0xFFA52A2E);

  static const brand = teal500;
  static const brandHover = teal600;
  static const brandActive = teal700;
  static const brandSubtle = teal50;
  static const brandSubtle2 = teal100;
  static const brandBorder = teal200;
  static const onBrand = Color(0xFFFFFFFF);

  static const surfacePage = slate50;
  static const surfaceCard = Color(0xFFFFFFFF);
  static const surfaceSunken = slate100;

  static const textStrong = slate900;
  static const textBody = slate700;
  static const textMuted = slate500;
  static const textFaint = slate400;
  static const textBrand = teal700;

  static const borderSubtle = slate200;
  static const borderDefault = slate300;
  static const focusRing = teal400;

  static const queueWaiting = amber600;
  static const queueWaitingBg = amber50;
  static const queueWaitingBorder = amber100;

  static const queueServing = teal600;
  static const queueServingBg = teal50;
  static const queueServingBorder = teal200;

  static const queueServed = green600;
  static const queueServedBg = green50;
  static const queueServedBorder = green100;

  static const queueSkipped = red600;
  static const queueSkippedBg = red50;
  static const queueSkippedBorder = red100;
}

class EQueRadii {
  EQueRadii._();
  static const xs = 4.0;
  static const sm = 6.0;
  static const md = 10.0;
  static const lg = 14.0;
  static const xl = 20.0;
  static const xl2 = 28.0;
  static const pill = 999.0;
}

class EQueSpace {
  EQueSpace._();
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 20.0;
  static const s6 = 24.0;
  static const s8 = 32.0;
  static const s10 = 40.0;
  static const s12 = 48.0;
}

class EQueShadows {
  EQueShadows._();
  static const sm = [
    BoxShadow(color: Color(0x0F151B1F), blurRadius: 2, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x14151B1F), blurRadius: 3, offset: Offset(0, 1)),
  ];
  static const md = [
    BoxShadow(color: Color(0x0D151B1F), blurRadius: 4, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x14151B1F), blurRadius: 16, offset: Offset(0, 6)),
  ];
  static const lg = [
    BoxShadow(color: Color(0x1A151B1F), blurRadius: 24, offset: Offset(0, 8)),
    BoxShadow(color: Color(0x0F151B1F), blurRadius: 6, offset: Offset(0, 2)),
  ];
  static const xl = [
    BoxShadow(color: Color(0x29151B1F), blurRadius: 48, offset: Offset(0, 18)),
    BoxShadow(color: Color(0x14151B1F), blurRadius: 16, offset: Offset(0, 6)),
  ];
}

ThemeData buildEQueTheme() {
  final base = ThemeData(useMaterial3: true, brightness: Brightness.light);
  final displayFont = GoogleFonts.spaceGroteskTextTheme(base.textTheme);
  final uiFont = GoogleFonts.manropeTextTheme(base.textTheme);

  final textTheme = uiFont.copyWith(
    displayLarge: displayFont.displayLarge?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700),
    displayMedium: displayFont.displayMedium?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700),
    displaySmall: displayFont.displaySmall?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700),
    headlineLarge: displayFont.headlineLarge?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700, letterSpacing: -0.02),
    headlineMedium: displayFont.headlineMedium?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700, letterSpacing: -0.02),
    headlineSmall: displayFont.headlineSmall?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700, letterSpacing: -0.02),
    titleLarge: uiFont.titleLarge?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700),
    titleMedium: uiFont.titleMedium?.copyWith(color: EQueColors.textStrong, fontWeight: FontWeight.w700),
    titleSmall: uiFont.titleSmall?.copyWith(color: EQueColors.textBody, fontWeight: FontWeight.w600),
    bodyLarge: uiFont.bodyLarge?.copyWith(color: EQueColors.textBody),
    bodyMedium: uiFont.bodyMedium?.copyWith(color: EQueColors.textBody),
    bodySmall: uiFont.bodySmall?.copyWith(color: EQueColors.textMuted),
    labelLarge: uiFont.labelLarge?.copyWith(color: EQueColors.textBody, fontWeight: FontWeight.w600),
  );

  return base.copyWith(
    scaffoldBackgroundColor: EQueColors.surfacePage,
    colorScheme: base.colorScheme.copyWith(
      primary: EQueColors.brand,
      onPrimary: EQueColors.onBrand,
      secondary: EQueColors.teal700,
      surface: EQueColors.surfaceCard,
      error: EQueColors.red500,
    ),
    textTheme: textTheme,
    appBarTheme: AppBarTheme(
      backgroundColor: EQueColors.surfaceCard,
      foregroundColor: EQueColors.textStrong,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      shadowColor: EQueColors.slate900.withValues(alpha: 0.08),
      centerTitle: true,
      titleTextStyle: GoogleFonts.spaceGrotesk(
        color: EQueColors.textStrong, fontWeight: FontWeight.w700, fontSize: 20, letterSpacing: -0.01,
      ),
      iconTheme: const IconThemeData(color: EQueColors.textBody),
    ),
    cardTheme: CardThemeData(
      color: EQueColors.surfaceCard,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EQueRadii.lg),
        side: const BorderSide(color: EQueColors.borderSubtle),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: EQueColors.brand,
        foregroundColor: EQueColors.onBrand,
        disabledBackgroundColor: EQueColors.brand.withValues(alpha: 0.5),
        elevation: 0,
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(EQueRadii.md)),
        textStyle: GoogleFonts.manrope(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: EQueColors.textStrong,
        side: const BorderSide(color: EQueColors.borderDefault),
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(EQueRadii.md)),
        textStyle: GoogleFonts.manrope(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: EQueColors.textBrand,
        textStyle: GoogleFonts.manrope(fontWeight: FontWeight.w700, fontSize: 14),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: EQueColors.surfaceCard,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EQueRadii.md),
        borderSide: const BorderSide(color: EQueColors.borderDefault),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EQueRadii.md),
        borderSide: const BorderSide(color: EQueColors.borderDefault),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EQueRadii.md),
        borderSide: const BorderSide(color: EQueColors.focusRing, width: 1.5),
      ),
      labelStyle: GoogleFonts.manrope(color: EQueColors.textBody, fontWeight: FontWeight.w600),
      hintStyle: GoogleFonts.manrope(color: EQueColors.textFaint),
    ),
    dividerTheme: const DividerThemeData(color: EQueColors.borderSubtle, thickness: 1, space: 1),
    progressIndicatorTheme: const ProgressIndicatorThemeData(color: EQueColors.brand),
    iconTheme: const IconThemeData(color: EQueColors.textBody),
    splashFactory: InkRipple.splashFactory,
  );
}
