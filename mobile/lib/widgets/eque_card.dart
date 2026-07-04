import 'package:flutter/material.dart';
import '../theme/eque_theme.dart';

/// eQue Card — biała powierzchnia z cienką obwódką i miękkim cieniem.
/// Odpowiednik `components/core/Card.jsx` z design systemu: obwódka robi
/// większość roboty przy oddzielaniu treści, cień to lekki akcent.
class EQueCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final VoidCallback? onTap;

  const EQueCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.radius = EQueRadii.lg,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: EQueColors.surfaceCard,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: EQueColors.borderSubtle),
        boxShadow: EQueShadows.sm,
      ),
      child: child,
    );

    if (onTap == null) return content;
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(radius),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: content,
      ),
    );
  }
}
