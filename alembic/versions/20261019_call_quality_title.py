"""The line's quality is named «Качество звонков», next to «Качество чатов» (docs/CHANNELS.md).

Only the untouched default title changes; a title a manager already set stays. Files with the old
«Качество работы» column still load: the import keeps it as a former title of `quality`.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261019_call_quality_title"
down_revision = "20261019_chat_channel"
branch_labels = depends_on = None


def _rename(old: str, new: str) -> None:
    op.execute(
        sa.text(
            "UPDATE metric_definitions SET title = :new WHERE code = 'quality' AND title = :old"
        ).bindparams(old=old, new=new)
    )


def upgrade():
    _rename("Качество работы", "Качество звонков")


def downgrade():
    _rename("Качество звонков", "Качество работы")
