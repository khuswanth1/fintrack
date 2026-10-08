"""google sign-in and webhooks

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-06 01:35:33.760893
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('webhook_endpoints',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('description', sa.String(length=120), nullable=False),
    sa.Column('secret', sa.String(length=80), nullable=False),
    sa.Column('events', sa.JSON(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('consecutive_failures', sa.Integer(), nullable=False),
    sa.Column('disabled_reason', sa.String(length=200), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_webhook_endpoints_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_webhook_endpoints'))
    )
    with op.batch_alter_table('webhook_endpoints', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_webhook_endpoints_user_id'), ['user_id'], unique=False)

    op.create_table('webhook_deliveries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('endpoint_id', sa.Integer(), nullable=False),
    sa.Column('event_id', sa.String(length=40), nullable=False),
    sa.Column('event_type', sa.String(length=60), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('response_status', sa.Integer(), nullable=True),
    sa.Column('response_body', sa.String(length=1000), nullable=True),
    sa.Column('error', sa.String(length=300), nullable=True),
    sa.Column('duration_ms', sa.Integer(), nullable=True),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('pending', 'retrying', 'success', 'failed')", name=op.f('ck_webhook_deliveries_status_valid')),
    sa.ForeignKeyConstraint(['endpoint_id'], ['webhook_endpoints.id'], name=op.f('fk_webhook_deliveries_endpoint_id_webhook_endpoints'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_webhook_deliveries'))
    )
    with op.batch_alter_table('webhook_deliveries', schema=None) as batch_op:
        batch_op.create_index('ix_webhook_deliveries_due', ['status', 'next_attempt_at'], unique=False)
        batch_op.create_index('ix_webhook_deliveries_endpoint_created', ['endpoint_id', 'created_at'], unique=False)

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('google_sub', sa.String(length=255), nullable=True))
        batch_op.alter_column('password_hash',
               existing_type=sa.VARCHAR(length=255),
               nullable=True)
        batch_op.create_unique_constraint(batch_op.f('uq_users_google_sub'), ['google_sub'])



def downgrade() -> None:
    # Google-only accounts have no password; give them an unusable hash so NOT NULL can be restored.
    op.execute("UPDATE users SET password_hash = '!' WHERE password_hash IS NULL")
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('uq_users_google_sub'), type_='unique')
        batch_op.alter_column('password_hash',
               existing_type=sa.VARCHAR(length=255),
               nullable=False)
        batch_op.drop_column('google_sub')

    with op.batch_alter_table('webhook_deliveries', schema=None) as batch_op:
        batch_op.drop_index('ix_webhook_deliveries_endpoint_created')
        batch_op.drop_index('ix_webhook_deliveries_due')

    op.drop_table('webhook_deliveries')
    with op.batch_alter_table('webhook_endpoints', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_webhook_endpoints_user_id'))

    op.drop_table('webhook_endpoints')
