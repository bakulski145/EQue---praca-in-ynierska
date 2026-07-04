"""add_paired_device_id_to_tablets

Revision ID: 40510a9d8801
Revises: c6bda52eea41
Create Date: 2026-07-04 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '40510a9d8801'
down_revision: Union[str, Sequence[str], None] = 'c6bda52eea41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('tablets', sa.Column('paired_device_id', sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('tablets', 'paired_device_id')
