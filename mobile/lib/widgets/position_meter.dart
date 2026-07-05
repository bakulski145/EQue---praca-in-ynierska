import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/eque_theme.dart';

class PositionMeter extends StatelessWidget {
  final int position;
  final int total;
  final String? eta;

  const PositionMeter({super.key, required this.position, required this.total, this.eta});

  @override
  Widget build(BuildContext context) {
    final isNext = position <= 0;
    final done = (total - position).clamp(0, total).toDouble();
    final pct = total > 0 ? (done / total).clamp(0.0, 1.0) : 1.0;
    final tone = isNext ? EQueColors.queueServing : EQueColors.brand;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(
              '$position',
              style: GoogleFonts.spaceGrotesk(
                fontSize: 48, fontWeight: FontWeight.w700, height: 1,
                letterSpacing: -0.5, color: tone,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '/ $total w kolejce',
              style: GoogleFonts.manrope(fontSize: 15, fontWeight: FontWeight.w600, color: EQueColors.textMuted),
            ),
          ],
        ),
        const SizedBox(height: 14),
        ClipRRect(
          borderRadius: BorderRadius.circular(EQueRadii.pill),
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: pct),
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeOut,
            builder: (context, value, _) => LinearProgressIndicator(
              value: value,
              minHeight: 8,
              backgroundColor: EQueColors.surfaceSunken,
              valueColor: AlwaysStoppedAnimation<Color>(tone),
            ),
          ),
        ),
        if (eta != null) ...[
          const SizedBox(height: 14),
          RichText(
            text: TextSpan(
              style: GoogleFonts.manrope(fontSize: 15, fontWeight: FontWeight.w500, color: EQueColors.textMuted),
              children: [
                const TextSpan(text: 'Szacowany czas: '),
                TextSpan(
                  text: eta,
                  style: GoogleFonts.manrope(
                    fontWeight: FontWeight.w700, color: EQueColors.textBody,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
