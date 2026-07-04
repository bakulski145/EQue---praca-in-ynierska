import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/eque_theme.dart';

/// Znak eQue: kolejka trzech przybliżających się kropek + "ptaszek" strzałki.
/// Odwzorowuje 1:1 `assets/logo-mark.svg` z design systemu (i `web/public/logo-mark.svg`),
/// namalowany wektorowo — bez ładowania pliku SVG.
class EQueLogoMark extends StatelessWidget {
  final double size;
  /// Wersja na ciemnym/kolorowym tle: przezroczyste białe tło zamiast pełnego tealu.
  final bool inverse;

  const EQueLogoMark({super.key, this.size = 36, this.inverse = false});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size),
      painter: _EQueLogoPainter(inverse: inverse),
    );
  }
}

class _EQueLogoPainter extends CustomPainter {
  final bool inverse;
  const _EQueLogoPainter({required this.inverse});

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 64;

    final bg = Paint()
      ..color = inverse ? Colors.white.withValues(alpha: 0.14) : EQueColors.brand;
    canvas.drawRRect(
      RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(16 * scale)),
      bg,
    );

    canvas.drawCircle(Offset(20 * scale, 38 * scale), 5 * scale, Paint()..color = Colors.white.withValues(alpha: 0.45));
    canvas.drawCircle(Offset(32 * scale, 38 * scale), 6 * scale, Paint()..color = Colors.white.withValues(alpha: 0.7));
    canvas.drawCircle(Offset(45 * scale, 38 * scale), 7.5 * scale, Paint()..color = Colors.white);

    final arrow = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3 * scale
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path()
      ..moveTo(40 * scale, 20.5 * scale)
      ..lineTo(45 * scale, 25 * scale)
      ..lineTo(50 * scale, 20.5 * scale);
    canvas.drawPath(path, arrow);
  }

  @override
  bool shouldRepaint(covariant _EQueLogoPainter oldDelegate) => oldDelegate.inverse != inverse;
}

/// Znak + wordmark "eQue" w jednym rzędzie — odpowiednik `Brand` z UI kitów
/// design systemu. Używać w nagłówkach ekranów zamiast gołego tekstu "eQue".
class EQueBrand extends StatelessWidget {
  final double markSize;
  final double fontSize;
  final bool inverse;

  const EQueBrand({super.key, this.markSize = 28, this.fontSize = 19, this.inverse = false});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        EQueLogoMark(size: markSize, inverse: inverse),
        const SizedBox(width: 9),
        Text(
          'eQue',
          style: GoogleFonts.spaceGrotesk(
            fontWeight: FontWeight.w700,
            fontSize: fontSize,
            letterSpacing: -0.01,
            color: inverse ? Colors.white : EQueColors.textStrong,
          ),
        ),
      ],
    );
  }
}
