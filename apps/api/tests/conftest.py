import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def avatar_store(monkeypatch):
    """Stands in for the private "avatars" bucket. put(photo_url, content)
    stores an object at the path that URL names; anything not put is
    missing, like a deleted photo."""
    from urllib.parse import urlparse

    from app.services import pdf

    objects: dict[str, bytes] = {}

    class Store:
        def put(self, photo_url: str, content: bytes) -> None:
            match = pdf._AVATAR_PATH.match(urlparse(photo_url).path)
            objects[match.group(1) if match else photo_url] = content

        downloads: list[str] = []

    store = Store()

    def download(path: str) -> bytes | None:
        store.downloads.append(path)
        return objects.get(path)

    monkeypatch.setattr(pdf, "_download_avatar", download)
    return store
