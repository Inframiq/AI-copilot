import uuid
from app.db.models import CoverLetter


def test_cover_letter_defaults():
    letter = CoverLetter(
        user_id=uuid.uuid4(),
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
    )
    assert letter.__tablename__ == "cover_letters"
    assert letter.tailoring_session_id is None
    assert letter.content is None
    assert letter.pdf_url is None
    # Column defaults (status="pending", humanize_level=50) are applied by
    # SQLAlchemy at INSERT/flush time, not at object construction — matching
    # every other model in this file (e.g. TailoringSession.status). Assert
    # on the mapped_column defaults directly rather than the unflushed
    # instance attribute.
    assert CoverLetter.__table__.c.status.default.arg == "pending"
    assert CoverLetter.__table__.c.humanize_level.default.arg == 50
