import os
from unittest.mock import MagicMock

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://mock:mock@localhost/mock")


def make_mock_conn():
    cur = MagicMock()
    cur.__enter__ = MagicMock(return_value=cur)
    cur.__exit__ = MagicMock(return_value=False)

    conn = MagicMock()
    conn.__enter__ = MagicMock(return_value=conn)
    conn.__exit__ = MagicMock(return_value=False)
    conn.cursor.return_value = cur
    return conn


@pytest.fixture
def mock_conn():
    return make_mock_conn()
