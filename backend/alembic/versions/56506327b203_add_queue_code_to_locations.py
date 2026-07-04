"""add_queue_code_to_locations

Revision ID: 56506327b203
Revises: d63338fa5256
Create Date: 2026-07-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '56506327b203'
down_revision: Union[str, Sequence[str], None] = '7b86e7afa6ba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('locations', sa.Column('queue_code', sa.String(length=2), nullable=True))

    # Backfill: przydziel kolejne litery A, B, C... istniejącym lokalizacjom wg id,
    # żeby kolumna mogła zostać NOT NULL + UNIQUE bez utraty danych.
    connection = op.get_bind()
    rows = connection.execute(sa.text('SELECT id FROM locations ORDER BY id ASC')).fetchall()
    for index, row in enumerate(rows):
        letter = chr(ord('A') + index)
        connection.execute(
            sa.text('UPDATE locations SET queue_code = :code WHERE id = :id'),
            {'code': letter, 'id': row.id},
        )

    op.alter_column('locations', 'queue_code', nullable=False)
    op.create_unique_constraint('uq_locations_queue_code', 'locations', ['queue_code'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('uq_locations_queue_code', 'locations', type_='unique')
    op.drop_column('locations', 'queue_code')
