from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "fixtures"


@pytest.fixture
def fixtures() -> Path:
    return FIXTURES
