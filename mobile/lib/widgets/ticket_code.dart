import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/eque_theme.dart';

enum TicketCodeSize { sm, md, lg, xl, hero }
enum TicketCodeTone { normal, brand, serving, onDark }

const _ticketSizes = {
  TicketCodeSize.sm: 20.0,
  TicketCodeSize.md: 30.0,
  TicketCodeSize.lg: 48.0,
  TicketCodeSize.xl: 64.0,
  TicketCodeSize.hero: 96.0,
};

const _ticketTones = {
  TicketCodeTone.normal: EQueColors.textStrong,
  TicketCodeTone.brand: EQueColors.brand,
  TicketCodeTone.serving: EQueColors.queueServing,
  TicketCodeTone.onDark: Colors.white,
};

class TicketCode extends StatelessWidget {
  final String code;
  final TicketCodeSize size;
  final TicketCodeTone tone;
  final double? fontSizeOverride;
  final double? letterSpacing;

  const TicketCode(
    this.code, {
    super.key,
    this.size = TicketCodeSize.md,
    this.tone = TicketCodeTone.normal,
    this.fontSizeOverride,
    this.letterSpacing,
  });

  @override
  Widget build(BuildContext context) {
    return Text(
      code,
      style: GoogleFonts.spaceGrotesk(
        fontSize: fontSizeOverride ?? _ticketSizes[size],
        fontWeight: FontWeight.w700,
        height: 1,
        letterSpacing: letterSpacing ?? -0.5,
        color: _ticketTones[tone],
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}
