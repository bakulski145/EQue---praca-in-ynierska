import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/eque_theme.dart';

enum QueueStatus { waiting, serving, served, skipped, paused }

class _StatusStyle {
  final Color fg, bg, bd;
  final String label;
  const _StatusStyle(this.fg, this.bg, this.bd, this.label);
}

const _statusStyles = {
  QueueStatus.waiting: _StatusStyle(EQueColors.queueWaiting, EQueColors.queueWaitingBg, EQueColors.queueWaitingBorder, 'Oczekuje'),
  QueueStatus.serving: _StatusStyle(EQueColors.queueServing, EQueColors.queueServingBg, EQueColors.queueServingBorder, 'W trakcie'),
  QueueStatus.served: _StatusStyle(EQueColors.queueServed, EQueColors.queueServedBg, EQueColors.queueServedBorder, 'Obsłużono'),
  QueueStatus.skipped: _StatusStyle(EQueColors.queueSkipped, EQueColors.queueSkippedBg, EQueColors.queueSkippedBorder, 'Nie zgłosił się'),
  QueueStatus.paused: _StatusStyle(EQueColors.slate600, EQueColors.surfaceSunken, EQueColors.borderSubtle, 'Wstrzymano'),
};

/// eQue StatusChip — kanoniczny znacznik stanu kolejki (pigułka z kropką +
/// polską etykietą). Stan "serving" domyślnie pulsuje ("na żywo").
class StatusChip extends StatelessWidget {
  final QueueStatus status;
  final String? label;
  final bool small;
  final bool? pulse;

  const StatusChip({super.key, required this.status, this.label, this.small = false, this.pulse});

  @override
  Widget build(BuildContext context) {
    final c = _statusStyles[status]!;
    final doPulse = pulse ?? status == QueueStatus.serving;
    final dot = small ? 7.0 : 8.0;

    return Container(
      padding: EdgeInsets.symmetric(horizontal: small ? 9 : 11, vertical: small ? 3 : 5),
      decoration: BoxDecoration(
        color: c.bg,
        borderRadius: BorderRadius.circular(EQueRadii.pill),
        border: Border.all(color: c.bd),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: dot,
            height: dot,
            child: doPulse ? _PulsingDot(color: c.fg, size: dot) : _StaticDot(color: c.fg, size: dot),
          ),
          const SizedBox(width: 7),
          Text(
            (label ?? c.label).toUpperCase(),
            style: GoogleFonts.manrope(
              fontSize: small ? 11 : 12.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
              color: c.fg,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

class _StaticDot extends StatelessWidget {
  final Color color;
  final double size;
  const _StaticDot({required this.color, required this.size});

  @override
  Widget build(BuildContext context) {
    return Container(width: size, height: size, decoration: BoxDecoration(color: color, shape: BoxShape.circle));
  }
}

/// Kropka z rozchodzącym się "ping" — sygnalizuje stan "na żywo" (serving).
class _PulsingDot extends StatefulWidget {
  final Color color;
  final double size;
  const _PulsingDot({required this.color, required this.size});

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final t = _controller.value;
        final scale = 1 + t * 1.6;
        final opacity = t < 0.7 ? 0.55 * (1 - t / 0.7) : 0.0;
        return Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            Transform.scale(
              scale: scale,
              child: Container(
                width: widget.size,
                height: widget.size,
                decoration: BoxDecoration(color: widget.color.withValues(alpha: opacity), shape: BoxShape.circle),
              ),
            ),
            Container(width: widget.size, height: widget.size, decoration: BoxDecoration(color: widget.color, shape: BoxShape.circle)),
          ],
        );
      },
    );
  }
}
